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
import { AgentEarning, AgentLocation, Booking, BookingItem, BookingStatusHistory, BookingVisit, CustomerAddress, ServicePricing } from 'src/database/entities';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { AgentContextService } from '../shared/agent-context.service';
import { AgentSkillsService } from '../skills/skills.service';
import { todayString, toTimeString } from '../shared/date.util';
import { ListAgentBookingsDto } from './dto/list-bookings.dto';
import { RejectAgentBookingDto } from './dto/reject-booking.dto';
import { StartAgentBookingDto } from './dto/start-booking.dto';
import { CompleteAgentBookingDto } from './dto/complete-booking.dto';
import { EnhancedBookingService } from './enhanced-booking.service';

const LIST_RELATIONS = ['items', 'items.service', 'address', 'customer'];
const DETAIL_RELATIONS = [...LIST_RELATIONS, 'customer.user', 'serviceArea'];

/** Default share of booking revenue paid to the agent when no payout is configured. */
const DEFAULT_PAYOUT_PERCENT = 60;

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
    private readonly context: AgentContextService,
    private readonly skills: AgentSkillsService,
    private readonly history: BookingHistoryService,
    private readonly notifications: NotificationDispatchService,
    private readonly settings: SettingsService,
    private readonly enhancedBooking: EnhancedBookingService,
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
    const assignedWhere: FindOptionsWhere<Booking> = {
      ...shared,
      agentId: agent.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const where =
      scope === 'available'
        ? [availableWhere]
        : scope === 'assigned'
          ? [assignedWhere]
          : [assignedWhere, availableWhere];

    // Available jobs read as a queue (soonest first); own jobs as a feed.
    const order =
      scope === 'available'
        ? ({ bookingDate: 'ASC', startTime: 'ASC' } as const)
        : ({ bookingDate: 'DESC', startTime: 'DESC' } as const);

    const [rows, total] = await this.bookingRepo.findAndCount({
      where,
      relations: LIST_RELATIONS,
      order,
      ...skipTake(query),
    });

    const items = await this.withSchedule(
      rows.map((booking) => this.toListItem(booking, agent.id)),
      rows,
    );
    if (scope !== 'available') {
      const withDistance = await this.annotateDistanceKm(agent.id, items);
      return paginated(withDistance, total, query);
    }

    const matched = await this.filterAvailableJobs(agent.id, items);
    return paginated(matched, matched.length, query);
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
    const [{ distanceKm }] = await this.annotateDistanceKm(agent.id, [listItem]);

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
      distanceKm,
      items: (booking.items ?? []).map((item) => ({
        serviceId: item.serviceId,
        serviceName: item.service?.name ?? null,
        quantity: item.quantity,
        durationMinutes: item.durationMinutes,
        amount: item.amount === null ? null : Number(item.amount),
      })),
    };
  }

  async accept(userId: string, bookingId: string) {
    const agent = await this.context.requireApprovedAgent(userId);

    // Claim the job with a conditional update so two agents can't both win it.
    const claimed = await this.bookingRepo.update(
      { id: bookingId, status: 'paid', agentId: IsNull() },
      { agentId: agent.id },
    );
    if (!claimed.affected) {
      const exists = await this.bookingRepo.count({ where: { id: bookingId } });
      if (!exists) throw new NotFoundException('Booking not found');
      throw new ConflictException('Job already taken');
    }

    const booking = await this.requireBooking(bookingId);
    await this.history.transition(booking, 'accepted', userId);

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

    const agentName = agent.firstName || 'Your expert';
    const otpLine = booking.startOtp
      ? ` Share start OTP ${booking.startOtp} when they arrive.`
      : '';
    await this.notifyCustomer(booking, {
      title: 'Expert assigned',
      message: `${agentName} has accepted booking ${booking.bookingNumber}.${otpLine}`,
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

  async arrived(userId: string, bookingId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    const booking = await this.requireAssignedBooking(bookingId, agent.id);

    await this.history.transition(booking, 'arriving', userId);

    await this.notifyCustomer(booking, {
      title: 'Agent on the way',
      message: `${agent.firstName || 'Your agent'} is arriving for booking ${booking.bookingNumber}.`,
      type: 'booking_arriving',
    });

    return this.toStatusResponse(booking);
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

    const finishedEarly = await this.finishCurrentVisit(booking, userId, dto.notes);
    if (finishedEarly) return finishedEarly;

    booking.endTime = toTimeString(new Date());
    if (dto.notes !== undefined) booking.notes = dto.notes;
    await this.history.transition(booking, 'completed', userId, dto.notes);

    const earning = await this.recordEarning(agent.id, booking);

    await this.notifyCustomer(booking, {
      title: 'Service completed',
      message: `Booking ${booking.bookingNumber} is done — rate your experience.`,
      type: 'booking_completed',
    });

    return {
      ...this.toStatusResponse(booking),
      endTime: booking.endTime,
      earning: {
        serviceHours: Number(earning.serviceHours),
        revenueGenerated: Number(earning.revenueGenerated),
        earningAmount: Number(earning.earningAmount),
        earningDate: earning.earningDate,
      },
    };
  }

  private async matchVisitOtp(booking: Booking, otp: string) {
    const visits = await this.visitRepo.find({
      where: { bookingId: booking.id },
      order: { visitDate: 'ASC', startTime: 'ASC' },
    });
    return visits.find((visit) => visit.status !== 'done' && visit.otp === otp) ?? null;
  }

  /** Marks the current visit done. Returns a response when later visits are still left. */
  private async finishCurrentVisit(booking: Booking, userId: string, notes?: string) {
    const visits = await this.visitRepo.find({
      where: { bookingId: booking.id },
      order: { visitDate: 'ASC', startTime: 'ASC' },
    });
    if (!visits.length) return null;

    const current =
      visits.find((visit) => visit.status === 'active') ??
      visits.find((visit) => visit.status === 'pending');
    if (current) {
      current.status = 'done';
      current.completedAt = new Date();
      await this.visitRepo.save(current);
    }

    const next = visits.find((visit) => visit.status === 'pending');
    if (!next) return null;

    booking.status = 'accepted';
    booking.startOtp = next.otp;
    booking.endTime = null;
    if (notes !== undefined) booking.notes = notes;
    await this.bookingRepo.save(booking);
    const label = current ? `${shiftName(current.shift)} on ${String(current.visitDate).slice(0, 10)}` : 'This visit';
    await this.history.record(booking.id, 'accepted', userId, `${label} completed`);
    await this.notifyCustomer(booking, {
      title: 'Visit completed',
      message: `${label} for booking ${booking.bookingNumber} is done. The next visit has a new OTP.`,
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
    const services = (booking.items ?? [])
      .map((item) => item.service?.name)
      .filter((name): name is string => !!name);
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
      services: services.length || !booking.planTitle ? services : [booking.planTitle],
      address: this.toAddress(booking.address, isMine),
      customerFirstName: booking.customer?.firstName ?? null,
      isAssignedToMe: isMine,
    };
  }

  /** Street-level detail is withheld until the agent owns the job. */
  private toAddress(address: CustomerAddress | null, isMine: boolean) {
    if (!address) return null;
    return {
      locality: address.addressLine2 ?? address.landmark,
      city: address.city,
      pincode: address.pincode,
      latitude: address.latitude === null ? null : Number(address.latitude),
      longitude: address.longitude === null ? null : Number(address.longitude),
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

  private toStatusResponse(booking: Booking) {
    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
    };
  }

  /**
   * Open pool is filtered by verified skills, then by last-known location vs
   * the 3 km (or 5 km boosted) radius. Jobs without coordinates stay visible.
   */
  private async filterAvailableJobs<
    T extends {
      id: string;
      services: string[];
      planType: Booking['planType'];
      address: { latitude?: number | null; longitude?: number | null } | null;
    },
  >(agentId: string, jobs: T[]) {
    const match = await this.skills.matchingContext(agentId);
    // On Demand is general help by the hour, so any approved agent can take it.
    const bySkill = jobs.filter(
      (job) =>
        job.planType === 'HOURLY' ||
        job.services.some((name) => matchesSkill(name, match.keywords)),
    );

    const withDistance = await this.annotateDistanceKm(agentId, bySkill);
    return withDistance.filter(
      (job) =>
        job.distanceKm == null || job.distanceKm <= match.serviceRadiusKm,
    );
  }

  /** Attaches straight-line distance (km) from the agent's last known GPS ping to each job's address. */
  private async annotateDistanceKm<
    T extends {
      address: { latitude?: number | null; longitude?: number | null } | null;
    },
  >(agentId: string, jobs: T[]) {
    const ping = await this.locationRepo.findOne({
      where: { agentId },
      order: { recordedAt: 'DESC' },
    });
    if (!ping) return jobs.map((job) => ({ ...job, distanceKm: null }));

    const origin = { lat: Number(ping.latitude), lng: Number(ping.longitude) };
    return jobs.map((job) => {
      const lat = job.address?.latitude;
      const lng = job.address?.longitude;
      const distanceKm =
        lat != null && lng != null ? haversineKm(origin.lat, origin.lng, lat, lng) : null;
      return { ...job, distanceKm };
    });
  }
}

function buildDateFilter(from?: string, to?: string) {
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
}

function matchesSkill(serviceName: string, keywords: string[]) {
  const haystack = serviceName.toLowerCase();
  return keywords.some(
    (keyword) => haystack.includes(keyword) || keyword.includes(haystack),
  );
}

function shiftName(shift: string) {
  if (shift === 'morning') return 'Morning';
  if (shift === 'evening') return 'Evening';
  return 'Visit';
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
