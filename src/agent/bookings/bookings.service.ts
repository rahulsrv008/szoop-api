import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Agent, AgentEarning, AgentLocation, Booking, BookingItem, BookingStatusHistory, BookingVisit, CustomerAddress, ServicePricing } from 'src/database/entities';
import { BookingEtaService } from 'src/integrations/maps/booking-eta.service';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { h3CellsWithinKm } from 'src/common/geo/geo.util';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { WalletService } from 'src/common/services/wallet.service';
import { EligibilityService } from 'src/dispatch/eligibility.service';
import {
  GeoPoint,
  LOCATION_MAX_AGE_MINUTES,
  MAX_RELEASES_PER_WINDOW,
  RELEASE_CUTOFF_MINUTES,
  RELEASE_WINDOW_DAYS,
  addressPoint,
  agentBase,
  agentOrigin,
  distanceKm,
  hasSkillFor,
  serviceNames,
} from 'src/dispatch/dispatch.rules';
import { AgentContextService } from '../shared/agent-context.service';
import { AgentSkillsService } from '../skills/skills.service';
import { toDateString, todayString, toTimeString } from '../shared/date.util';
import { ListAgentBookingsDto } from './dto/list-bookings.dto';
import { RejectAgentBookingDto } from './dto/reject-booking.dto';
import { StartAgentBookingDto } from './dto/start-booking.dto';
import { CompleteAgentBookingDto } from './dto/complete-booking.dto';
import { OnTheWayDto } from './dto/on-the-way.dto';
import { EnhancedBookingService } from './enhanced-booking.service';

const LIST_RELATIONS = ['items', 'items.service', 'address', 'customer'];
const DETAIL_RELATIONS = [...LIST_RELATIONS, 'customer.user', 'serviceArea'];

/** Default share of booking revenue paid to the agent when no payout is configured. */
const DEFAULT_PAYOUT_PERCENT = 60;

/** Cap on open jobs read per request before in-memory matching. */
const OPEN_POOL_SCAN_LIMIT = 500;

/** Open jobs older than this can't still be live: plans run at most ~30 days from their first visit. */
const OPEN_POOL_LOOKBACK_DAYS = 35;

/** Open-job coordinates are rounded to ~1 km: enough for a map pin, not enough to find the door. */
const OPEN_JOB_COORD_DECIMALS = 2;

/** The start OTP for the customer to share, when the booking has one. */
function otpLine(booking: Booking) {
  return booking.startOtp ? ` Share start OTP ${booking.startOtp} when they arrive.` : '';
}

@Injectable()
export class AgentBookingsService {
  private readonly logger = new Logger(AgentBookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingVisit)
    private readonly visitRepo: Repository<BookingVisit>,
    @InjectRepository(BookingStatusHistory)
    private readonly historyRepo: Repository<BookingStatusHistory>,
    @InjectRepository(AgentEarning)
    private readonly earningRepo: Repository<AgentEarning>,
    @InjectRepository(ServicePricing)
    private readonly pricingRepo: Repository<ServicePricing>,
    @InjectRepository(AgentLocation)
    private readonly locationRepo: Repository<AgentLocation>,
    private readonly bookingEta: BookingEtaService,
    private readonly context: AgentContextService,
    private readonly skills: AgentSkillsService,
    private readonly history: BookingHistoryService,
    private readonly notifications: NotificationDispatchService,
    private readonly settings: SettingsService,
    private readonly enhancedBooking: EnhancedBookingService,
    private readonly eligibility: EligibilityService,
    private readonly dispatch: DispatchService,
    private readonly wallet: WalletService,
  ) {}

  async list(userId: string, query: ListAgentBookingsDto) {
    const agent = await this.context.requireApprovedAgent(userId);
    const scope = query.scope ?? 'assigned';

    const dateFilter = buildDateFilter(query.from, query.to);
    const shared: FindOptionsWhere<Booking> = {
      ...(dateFilter ? { bookingDate: dateFilter } : {}),
    };

    // The open pool is always unassigned + paid, whatever status filter came in.
    const availableWhere: FindOptionsWhere<Booking> = {
      ...shared,
      agentId: IsNull(),
      status: 'paid',
    };
    if (scope === 'available') {
      // Online agents poll this, so it also keeps dispatch moving where no timer runs.
      await this.dispatch.tickFromRequest();
      return this.listAvailable(agent, availableWhere, query);
    }

    const assignedWhere: FindOptionsWhere<Booking> = {
      ...shared,
      agentId: agent.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const where =
      scope === 'assigned' ? [assignedWhere] : [assignedWhere, availableWhere];

    // Own jobs read as a feed (latest first).
    const [rows, total] = await this.bookingRepo.findAndCount({
      where,
      relations: LIST_RELATIONS,
      order: { bookingDate: 'DESC', startTime: 'DESC' },
      ...skipTake(query),
    });

    const items = await this.withSchedule(
      rows.map((booking) => this.toListItem(booking, agent.id)),
      rows,
    );
    return paginated(
      this.withDistanceKm(agentOrigin(agent), items, rows),
      total,
      query,
    );
  }

  /**
   * The open pool, narrowed in SQL to the agent's zones plus the H3 cells
   * around a fresh GPS fix (or their home when the fix is stale), then matched
   * in memory on still being due, exact distance, skills and the agent's own
   * schedule. Jobs the dispatcher has offered to this
   * agent are always included and listed first, with `offerExpiresAt`.
   * Paginated after matching so `total` is real.
   */
  private async listAvailable(
    agent: Agent,
    availableWhere: FindOptionsWhere<Booking>,
    query: ListAgentBookingsDto,
  ) {
    const [match, offers] = await Promise.all([
      this.skills.matchingContext(agent.id),
      this.dispatch.pendingOffers(agent.id),
    ]);
    const origin = agentBase(agent)?.point ?? null;
    const zones = [...(agent.serviceAreas ?? []), agent.homeZoneId].filter(
      (id): id is string => !!id,
    );
    const nearbyCells = origin
      ? h3CellsWithinKm(origin.lat, origin.lng, match.serviceRadiusKm)
      : [];

    if (!availableWhere.bookingDate) {
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - OPEN_POOL_LOOKBACK_DAYS);
      availableWhere = { ...availableWhere, bookingDate: MoreThanOrEqual(toDateString(lookback)) };
    }

    const where: FindOptionsWhere<Booking>[] = [];
    if (zones.length) where.push({ ...availableWhere, serviceAreaId: In(zones) });
    if (nearbyCells.length) {
      where.push({ ...availableWhere, address: { h3Cell: In(nearbyCells) } });
    }
    if (offers.size) where.push({ ...availableWhere, id: In([...offers.keys()]) });
    if (!where.length) return paginated([], 0, query);

    // Available jobs read as a queue (soonest first).
    const rows = await this.bookingRepo.find({
      where,
      relations: LIST_RELATIONS,
      order: { bookingDate: 'ASC', startTime: 'ASC' },
      take: OPEN_POOL_SCAN_LIMIT,
    });

    // Inside the agent's zones distance doesn't matter; outside, the H3 cells
    // were only a superset, so the exact radius decides.
    // An offer was already vetted by the dispatcher (possibly from further out).
    const zoneSet = new Set(zones);
    const due = await this.eligibility.nextStarts(rows);
    const matched = rows.filter((booking) => {
      if (!due.has(booking.id)) return false;
      if (offers.has(booking.id)) return true;
      if (!hasSkillFor(booking, match.keywords)) return false;
      if (booking.serviceAreaId && zoneSet.has(booking.serviceAreaId)) return true;
      const km = distanceKm(origin, booking.address);
      return km !== null && km <= match.serviceRadiusKm;
    });
    const blocked = await this.eligibility.blockedJobs(agent.id, matched);
    const eligible = matched
      .filter((booking) => !blocked.has(booking.id))
      .sort((a, b) => Number(offers.has(b.id)) - Number(offers.has(a.id)));

    const { skip, take } = skipTake(query);
    const page = eligible.slice(skip, skip + take);
    const items = await this.withSchedule(
      page.map((booking) => this.toListItem(booking, agent.id)),
      page,
    );
    // When each job stops being open, so the app can drop it without refetching:
    // its start, or sooner for a "Right now" job whose 10-minute search ends first.
    // Multi-visit plans stay listed for their next visit, so they get none.
    const searchEnds = await this.dispatch.searchEndsAt(
      page.filter((booking) => booking.bookingMode === 'INSTANT').map((booking) => booking.id),
    );
    const withOffers = this.withDistanceKm(origin, items, page).map((item) => {
      const start = due.get(item.id);
      const searchEnd = searchEnds.get(item.id);
      const expiresAt =
        item.visitsTotal > 1 || !start
          ? null
          : searchEnd && searchEnd < start
            ? searchEnd
            : start;
      return {
        ...item,
        offerExpiresAt: offers.get(item.id)?.toISOString() ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    });
    return paginated(withOffers, eligible.length, query);
  }

  async detail(userId: string, bookingId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: DETAIL_RELATIONS,
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const isMine = booking.agentId === agent.id;
    const isOpenJob = !booking.agentId && booking.status === 'paid';
    if (!isMine && !isOpenJob) {
      throw new NotFoundException('Booking not found');
    }

    const [listItem] = await this.withSchedule(
      [this.toListItem(booking, agent.id)],
      [booking],
    );
    const km = distanceKm(agentOrigin(agent), booking.address);

    return {
      ...listItem,
      notes: booking.notes,
      subtotal: Number(booking.subtotal),
      discount: Number(booking.discount),
      tax: Number(booking.tax),
      paymentStatus: booking.paymentStatus,
      endTime: booking.endTime,
      serviceAreaName: booking.serviceArea?.name ?? null,
      // Only an assigned agent gets a way to contact the customer.
      customerMobile: isMine ? (booking.customer?.user?.mobile ?? null) : null,
      address: this.toAddress(booking.address, isMine),
      distanceKm: km,
      items: (booking.items ?? []).map((item) => ({
        serviceId: item.serviceId,
        serviceName: item.service?.name ?? null,
        quantity: item.quantity,
        durationMinutes: item.durationMinutes,
        amount: item.amount === null ? null : Number(item.amount),
      })),
    };
  }

  /**
   * Claims an open job. A "Right now" job is accepted and set off on in one
   * step: the customer is already waiting, so there's no "accepted but not
   * moving" state for it (the no-show rules in HeldJobsService then only
   * have to watch for a job that's never started).
   */
  async accept(userId: string, bookingId: string, dto: OnTheWayDto = {}) {
    const agent = await this.context.requireApprovedAgent(userId);

    const target = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!target) throw new NotFoundException('Booking not found');
    // A retry after a slow first attempt: the job is already this agent's.
    if (target.agentId === agent.id && target.status !== 'cancelled' && target.status !== 'expired') {
      // The first attempt may have claimed a "Right now" job without getting as far as setting off.
      if (target.bookingMode === 'INSTANT' && target.status === 'accepted') {
        return this.setOff(agent, await this.requireBooking(bookingId), userId, dto);
      }
      return this.toStatusResponse(target);
    }
    const due = await this.eligibility.nextStarts([target]);
    if (!due.has(target.id)) {
      throw new ConflictException('This job has expired');
    }
    await this.assertFitsSchedule(agent.id, target);

    // Claim the job with a conditional update so two agents can't both win it.
    const claimed = await this.bookingRepo.update(
      { id: bookingId, status: 'paid', agentId: IsNull() },
      { agentId: agent.id },
    );
    if (!claimed.affected) {
      const now = await this.bookingRepo.findOne({ where: { id: bookingId }, select: ['id', 'status'] });
      if (!now) throw new NotFoundException('Booking not found');
      if (now.status === 'expired') throw new ConflictException('This job has expired');
      if (now.status === 'cancelled') throw new ConflictException('This job was cancelled');
      throw new ConflictException('Job already taken');
    }

    // Re-check now that the claim is visible: two near-simultaneous accepts of
    // overlapping jobs by this agent each passed the check above. Claimed jobs
    // count as committed, so at least one of them sees the clash and lets go.
    try {
      await this.assertFitsSchedule(agent.id, target);
    } catch (err) {
      await this.bookingRepo.update(
        { id: bookingId, agentId: agent.id, status: 'paid' },
        { agentId: null },
      );
      throw err;
    }

    const booking = await this.requireBooking(bookingId);
    await this.history.transition(booking, 'accepted', userId);
    await this.dispatch.onAccepted(bookingId, agent.id);

    // Initialize the service checklist for this booking. Failure here must
    // never block the accept flow — the agent still gets the job either way.
    try {
      await this.enhancedBooking.onBookingAccepted(bookingId);
    } catch (err) {
      this.logger.error(
        `Failed to initialize checklist for booking ${bookingId}`,
        err as Error,
      );
    }

    if (booking.bookingMode === 'INSTANT') {
      // One message for the customer: on the way, when, and the OTP to share.
      return this.setOff(agent, booking, userId, dto);
    }

    const agentName = agent.firstName || 'Your expert';
    await this.notifyCustomer(booking, {
      title: 'Expert assigned',
      message: `${agentName} has accepted booking ${booking.bookingNumber}.${otpLine(booking)}`,
      type: 'booking_accepted',
    });

    return this.toStatusResponse(booking);
  }

  async reject(userId: string, bookingId: string, dto: RejectAgentBookingDto) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireBooking(bookingId);

    const isMine = booking.agentId === agent.id;
    if (
      isMine &&
      ['ongoing', 'completed', 'cancelled'].includes(booking.status)
    ) {
      throw new BadRequestException('This job can no longer be rejected');
    }
    if (isMine) await this.assertCanRelease(agent.id, booking);

    if (isMine) {
      // Back into the open pool: 'paid' is the pre-assignment state, and the
      // status machine has no accepted → paid edge, so this is written directly.
      booking.agentId = null;
      booking.status = 'paid';
      await this.bookingRepo.save(booking);
    }

    await this.history.record(
      booking.id,
      booking.status,
      userId,
      dto.reason ? `Rejected by agent: ${dto.reason}` : 'Rejected by agent',
    );

    // Don't offer it to this agent again; a released job goes straight back to dispatch.
    if (booking.status === 'paid' && !booking.agentId) {
      await this.dispatch.onDeclined(booking.id, agent.id, isMine ? 'released' : 'declined');
    }

    if (isMine) {
      await this.notifyCustomer(booking, {
        title: 'Expert released your job',
        message: `${agent.firstName || 'Your expert'} is no longer assigned to booking ${booking.bookingNumber}.`,
        type: 'booking_released',
      });
    }

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      released: isMine,
    };
  }

  async arrived(userId: string, bookingId: string, dto: OnTheWayDto = {}) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireAssignedBooking(bookingId, agent.id);
    return this.setOff(agent, booking, userId, dto);
  }

  /** "On the way": records where the agent set off from, routes an ETA and tells the customer. */
  private async setOff(agent: Agent, booking: Booking, userId: string, dto: OnTheWayDto) {
    // A retry after a slow first attempt: already on the way, just refresh the ETA.
    const alreadyOnTheWay = booking.status === 'arriving';
    // Set off straight from accepting ("Right now"): the customer hasn't had the OTP yet.
    const fromAccept = booking.status === 'accepted' && booking.bookingMode === 'INSTANT';

    const origin = await this.setOffFrom(agent, booking.id, dto);
    const destination = addressPoint(booking.address);
    const eta =
      origin && destination
        ? await this.bookingEta.refresh(booking.id, origin, destination).catch((err) => {
            this.logger.warn(`ETA for ${booking.bookingNumber} failed: ${(err as Error).message}`);
            return null;
          })
        : null;

    if (!alreadyOnTheWay) {
      await this.history.transition(booking, 'arriving', userId);
      const name = agent.firstName || 'Your agent';
      await this.notifyCustomer(booking, {
        title: eta ? `Expert arriving in ~${eta.minutes} min` : 'Agent on the way',
        message: `${
          eta
            ? `${name} is on the way for booking ${booking.bookingNumber} and should reach you in about ${eta.minutes} min (${eta.distanceKm} km).`
            : `${name} is arriving for booking ${booking.bookingNumber}.`
        }${fromAccept ? otpLine(booking) : ''}`,
        type: 'booking_arriving',
      });
    }

    return {
      ...this.toStatusResponse(booking),
      etaMinutes: eta?.minutes ?? null,
      distanceKm: eta?.distanceKm ?? null,
      etaSource: eta?.source ?? null,
    };
  }

  /** The agent's position as they set off: sent with the request, else a recent GPS ping. */
  private async setOffFrom(agent: Agent, bookingId: string, dto: OnTheWayDto) {
    if (dto.latitude != null && dto.longitude != null) {
      await this.locationRepo.save(
        this.locationRepo.create({
          agentId: agent.id,
          bookingId,
          latitude: dto.latitude.toFixed(7),
          longitude: dto.longitude.toFixed(7),
        }),
      );
      return { latitude: dto.latitude, longitude: dto.longitude };
    }
    const fix = agentOrigin(agent, LOCATION_MAX_AGE_MINUTES);
    return fix ? { latitude: fix.lat, longitude: fix.lng } : null;
  }

  async start(userId: string, bookingId: string, dto: StartAgentBookingDto) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireAssignedBooking(bookingId, agent.id);

    if (!['arriving', 'accepted'].includes(booking.status)) {
      throw new BadRequestException('Booking is not ready to start');
    }
    const visit = await this.matchVisitOtp(booking, dto.otp);
    if (!visit && (!booking.startOtp || booking.startOtp !== dto.otp)) {
      throw new BadRequestException('Incorrect start OTP');
    }
    if (visit && visit.status !== 'active') {
      visit.status = 'active';
      await this.visitRepo.save(visit);
    }

    await this.history.transition(booking, 'ongoing', userId);

    await this.notifyCustomer(booking, {
      title: 'Service started',
      message: `Work has started on booking ${booking.bookingNumber}.`,
      type: 'booking_started',
    });

    return this.toStatusResponse(booking);
  }

  async complete(
    userId: string,
    bookingId: string,
    dto: CompleteAgentBookingDto,
  ) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireAssignedBooking(bookingId, agent.id);

    // A repeat of a completion that already went through (double tap, retry): nothing more to do.
    if (booking.status === 'completed') return this.toStatusResponse(booking);
    if (booking.status !== 'ongoing') {
      throw new BadRequestException('Start the job with the customer OTP before completing it');
    }
    // Pay after service: closed only once the customer has paid, unless the
    // agent reports they refused; then the amount is owed in their wallet.
    const unpaid = booking.paymentMode === 'AFTER_SERVICE' && booking.paymentStatus !== 'PAID';
    if (unpaid && !dto.customerRefusedPayment) {
      throw new ConflictException(
        "The customer hasn't paid yet. Ask them to pay in their app or scan the payment QR.",
      );
    }

    const finishedEarly = await this.finishCurrentVisit(booking, userId, dto.notes);
    if (finishedEarly) return finishedEarly;

    // Claimed with a conditional update, so two calls at once can't both complete it.
    const endTime = toTimeString(new Date());
    const claimed = await this.bookingRepo.update(
      { id: booking.id, status: 'ongoing' },
      { status: 'completed', endTime, ...(dto.notes !== undefined ? { notes: dto.notes } : {}) },
    );
    if (!claimed.affected) return this.toStatusResponse(await this.requireBooking(booking.id));
    booking.status = 'completed';
    booking.endTime = endTime;
    if (dto.notes !== undefined) booking.notes = dto.notes;
    const amountDue = unpaid ? await this.recordDueIfUnpaid(booking.id) : 0;
    const remarks = amountDue > 0
      ? [`Customer did not pay: ₹${amountDue} owed in their wallet`, dto.notes].filter(Boolean).join(' · ')
      : dto.notes;
    await this.history.record(booking.id, 'completed', userId, remarks);
    if (amountDue > 0) {
      await this.notifyCustomer(booking, {
        title: 'Payment due',
        message: `Booking ${booking.bookingNumber} is done, but ₹${amountDue} wasn't paid. It's shown as due in your wallet; pay it from the booking.`,
        type: 'wallet_due',
      });
    }

    const earning = await this.recordEarning(agent.id, booking);

    await this.notifyCustomer(booking, {
      title: 'Service completed',
      message: `Booking ${booking.bookingNumber} is done — rate your experience.`,
      type: 'booking_completed',
    });

    return {
      ...this.toStatusResponse(booking),
      endTime: booking.endTime,
      amountDue,
      earning: {
        serviceHours: Number(earning.serviceHours),
        revenueGenerated: Number(earning.revenueGenerated),
        earningAmount: Number(earning.earningAmount),
        earningDate: earning.earningDate,
      },
    };
  }

  /**
   * What the agent's app needs to collect a pay-after-service booking: whether
   * it's paid yet, and the link the payment QR encodes (opens the customer
   * app's pay screen for this booking).
   */
  async paymentStatus(userId: string, bookingId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireAssignedBooking(bookingId, agent.id);
    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      paymentMode: booking.paymentMode,
      paymentStatus: booking.paymentStatus,
      amount: Number(booking.totalAmount),
      payUrl: `${process.env.CUSTOMER_PAY_URL_BASE || 'clearit://pay/'}${booking.id}`,
    };
  }

  /** Records the amount as owed, unless a payment landed while the job was being closed. */
  private recordDueIfUnpaid(bookingId: string) {
    return this.bookingRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOneOrFail(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked.paymentStatus === 'PAID') return 0;
      return this.wallet.recordDue(locked, manager);
    });
  }

  private async matchVisitOtp(booking: Booking, otp: string) {
    const visits = await this.visitRepo.find({
      where: { bookingId: booking.id },
      order: { visitDate: 'ASC', startTime: 'ASC' },
    });
    return visits.find((visit) => visit.status !== 'done' && visit.otp === otp) ?? null;
  }

  /**
   * Marks the current visit done. Returns a response when later visits are
   * still left (or when another call already finished this one). The booking
   * row is locked and re-checked first, so two Complete calls at once can't
   * finish two visits.
   */
  private async finishCurrentVisit(booking: Booking, userId: string, notes?: string) {
    const outcome = await this.bookingRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Booking, {
        where: { id: booking.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'ongoing') return { kind: 'stale' as const };

      const visits = await manager.find(BookingVisit, {
        where: { bookingId: booking.id },
        order: { visitDate: 'ASC', startTime: 'ASC' },
      });
      if (!visits.length) return { kind: 'single' as const };

      const current =
        visits.find((visit) => visit.status === 'active') ??
        visits.find((visit) => visit.status === 'pending');
      if (current) {
        await manager.update(BookingVisit, { id: current.id }, { status: 'done', completedAt: new Date() });
        current.status = 'done';
      }

      const next = visits.find((visit) => visit.status === 'pending');
      if (!next) return { kind: 'last' as const };

      const label = current ? `${shiftName(current.shift)} on ${String(current.visitDate).slice(0, 10)}` : 'This visit';
      await manager.update(
        Booking,
        { id: booking.id },
        { status: 'accepted', startOtp: next.otp, endTime: null, ...(notes !== undefined ? { notes } : {}) },
      );
      await manager.save(
        manager.create(BookingStatusHistory, {
          bookingId: booking.id,
          status: 'accepted',
          changedBy: userId,
          remarks: `${label} completed`,
        }),
      );
      return { kind: 'next' as const, label, otp: next.otp };
    });

    if (outcome.kind === 'stale') return this.toStatusResponse(await this.requireBooking(booking.id));
    if (outcome.kind !== 'next') return null;

    booking.status = 'accepted';
    booking.startOtp = outcome.otp;
    booking.endTime = null;
    if (notes !== undefined) booking.notes = notes;
    await this.notifyCustomer(booking, {
      title: 'Visit completed',
      message: `${outcome.label} for booking ${booking.bookingNumber} is done. The next visit has a new OTP.`,
      type: 'booking_visit_done',
    });
    return this.toStatusResponse(booking);
  }


  /**
   * Agent payout: per-hour rates from `service_pricing` when every booked
   * service has one, otherwise a flat percentage of the booking revenue.
   */
  private async recordEarning(agentId: string, booking: Booking) {
    const existing = await this.earningRepo.findOne({
      where: { bookingId: booking.id },
    });
    if (existing) return existing;

    const serviceHours = booking.durationMinutes / 60;
    const revenueGenerated = Number(booking.totalAmount);
    const fromPricing = await this.payoutFromPricing(booking);

    const payoutPercent = await this.settings.getNumber(
      SETTING_KEYS.AGENT_PAYOUT_PERCENT,
      DEFAULT_PAYOUT_PERCENT,
    );
    const earningAmount =
      fromPricing ?? (revenueGenerated * payoutPercent) / 100;

    return this.earningRepo.save(
      this.earningRepo.create({
        agentId,
        bookingId: booking.id,
        serviceHours: serviceHours.toFixed(2),
        revenueGenerated: revenueGenerated.toFixed(2),
        earningAmount: earningAmount.toFixed(2),
        earningDate: todayString(),
      }),
    );
  }

  /** Returns null unless every booked service has a configured hourly payout. */
  private async payoutFromPricing(booking: Booking) {
    const items = booking.items ?? [];
    if (!items.length) return null;

    let total = 0;
    for (const item of items) {
      const payout = await this.hourlyPayout(item, booking.serviceAreaId);
      if (payout === null) return null;
      const minutes = item.durationMinutes ?? booking.durationMinutes;
      total += payout * (minutes / 60) * (item.quantity || 1);
    }
    return total;
  }

  private async hourlyPayout(item: BookingItem, serviceAreaId: string | null) {
    const rows = await this.pricingRepo.find({
      where: { serviceId: item.serviceId, isActive: true },
    });
    // Area-specific pricing wins over the national default.
    const pricing =
      rows.find((row) => row.serviceAreaId === serviceAreaId) ??
      rows.find((row) => row.serviceAreaId === null);
    return pricing?.agentPayoutPerHour
      ? Number(pricing.agentPayoutPerHour)
      : null;
  }

  private async requireBooking(bookingId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: DETAIL_RELATIONS,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /**
   * Guard for the checklist / phase endpoints: the caller must be an approved
   * agent holding this job. Anyone else gets 404, so they can't even tell it exists.
   */
  async requireOwnJob(userId: string, bookingId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    return this.requireAssignedBooking(bookingId, agent.id);
  }

  private async requireAssignedBooking(bookingId: string, agentId: string) {
    const booking = await this.requireBooking(bookingId);
    if (booking.agentId !== agentId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private notifyCustomer(
    booking: Booking,
    input: { title: string; message: string; type: string },
  ) {
    const customerUserId = booking.customer?.userId;
    if (!customerUserId) return Promise.resolve(undefined);
    return this.notifications.toUser(customerUserId, {
      app: 'customer',
      ...input,
      data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
    });
  }

  /** Visit counts for monthly plans, and the moment an in-progress job actually started. */
  private async withSchedule<T extends { id: string }>(items: T[], rows: Booking[]) {
    const ids = rows.map((row) => row.id);
    const visits = ids.length
      ? await this.visitRepo.find({ where: { bookingId: In(ids) } })
      : [];
    const ongoingIds = rows.filter((row) => row.status === 'ongoing').map((row) => row.id);
    const history = ongoingIds.length
      ? await this.historyRepo.find({
          where: { bookingId: In(ongoingIds), status: 'ongoing' },
          order: { createdAt: 'ASC' },
        })
      : [];
    const startedAt = new Map<string, Date>();
    for (const row of history) {
      if (!startedAt.has(row.bookingId)) startedAt.set(row.bookingId, row.createdAt);
    }
    const grouped = new Map<string, BookingVisit[]>();
    for (const visit of visits) {
      const list = grouped.get(visit.bookingId) ?? [];
      list.push(visit);
      grouped.set(visit.bookingId, list);
    }
    return items.map((item) => {
      const plan = grouped.get(item.id) ?? [];
      const done = plan.filter((visit) => visit.status === 'done').length;
      const total = plan.length;
      const next = plan
        .filter((visit) => visit.status !== 'done')
        .sort((a, b) =>
          `${String(a.visitDate).slice(0, 10)}${a.startTime}`.localeCompare(
            `${String(b.visitDate).slice(0, 10)}${b.startTime}`,
          ),
        )[0];
      return {
        ...item,
        visitsTotal: total,
        visitsDone: done,
        visitsScheduled: total > 1 ? Math.max(0, total - done - (done < total ? 1 : 0)) : 0,
        startedAt: startedAt.get(item.id)?.toISOString() ?? null,
        nextVisitDate: next ? String(next.visitDate).slice(0, 10) : null,
        nextVisitTime: next?.startTime ?? null,
      };
    });
  }

  private toListItem(booking: Booking, agentId: string) {
    const isMine = booking.agentId === agentId;
    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      durationMinutes: booking.durationMinutes,
      totalAmount: Number(booking.totalAmount),
      planType: booking.planType,
      planTitle: booking.planTitle,
      services: serviceNames(booking),
      address: this.toAddress(booking.address, isMine),
      customerFirstName: booking.customer?.firstName ?? null,
      isAssignedToMe: isMine,
      paymentMode: booking.paymentMode,
      paymentStatus: booking.paymentStatus,
      // "Right now" jobs are accepted and set off on in one tap.
      bookingMode: booking.bookingMode,
    };
  }

  /** Street-level detail is withheld until the agent owns the job. */
  private toAddress(address: CustomerAddress | null, isMine: boolean) {
    if (!address) return null;
    return {
      locality: address.addressLine2 ?? address.landmark,
      city: address.city,
      pincode: address.pincode,
      latitude: toPublicCoord(address.latitude, isMine),
      longitude: toPublicCoord(address.longitude, isMine),
      ...(isMine
        ? {
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2,
            landmark: address.landmark,
            state: address.state,
          }
        : {}),
    };
  }

  /**
   * Handing back a job the agent holds: not once they're on the way, not
   * within RELEASE_CUTOFF_MINUTES of the start (the customer can't be left
   * hanging), and not more than MAX_RELEASES_PER_WINDOW times a month.
   * Past those limits it goes through support, who can reassign it.
   */
  private async assertCanRelease(agentId: string, booking: Booking) {
    if (booking.status === 'arriving') {
      throw new BadRequestException(
        "You're already on your way. Contact support to hand this job back.",
      );
    }
    const start = (await this.eligibility.nextStarts([booking])).get(booking.id);
    if (!start || start.getTime() - Date.now() < RELEASE_CUTOFF_MINUTES * 60_000) {
      throw new BadRequestException(
        `Jobs can't be released within ${RELEASE_CUTOFF_MINUTES / 60} hours of the start. Contact support.`,
      );
    }
    const recent = await this.dispatch.recentReleases(agentId, RELEASE_WINDOW_DAYS);
    if (recent >= MAX_RELEASES_PER_WINDOW) {
      throw new BadRequestException(
        `You've released ${recent} jobs in the last ${RELEASE_WINDOW_DAYS} days. Contact support to release this one.`,
      );
    }
  }

  private async assertFitsSchedule(agentId: string, booking: Booking) {
    const blocked = await this.eligibility.blockedJobs(agentId, [booking]);
    if (blocked.has(booking.id)) {
      throw new ConflictException(
        'This job clashes with your availability or another job you hold',
      );
    }
  }

  private toStatusResponse(booking: Booking) {
    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
    };
  }

  /** Attaches `distanceKm`, computed from the stored (unrounded) address of each row. */
  private withDistanceKm<T extends { id: string }>(
    origin: GeoPoint | null,
    items: T[],
    rows: Booking[],
  ) {
    const addressOf = new Map(rows.map((row) => [row.id, row.address]));
    return items.map((item) => ({
      ...item,
      distanceKm: distanceKm(origin, addressOf.get(item.id)),
    }));
  }
}

function buildDateFilter(from?: string, to?: string) {
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
}

function shiftName(shift: string) {
  if (shift === 'morning') return 'Morning';
  if (shift === 'evening') return 'Evening';
  return 'Visit';
}

function toPublicCoord(value: string | null, exact: boolean) {
  if (value === null) return null;
  const coord = Number(value);
  return exact ? coord : Number(coord.toFixed(OPEN_JOB_COORD_DECIMALS));
}
