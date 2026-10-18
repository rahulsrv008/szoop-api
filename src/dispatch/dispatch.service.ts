import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  In,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import {
  Agent,
  Booking,
  BookingDispatch,
  BookingOffer,
} from 'src/database/entities';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { BookingClosureService, couponNote } from 'src/common/booking/booking-closure.service';
import { PAYMENT_WINDOW_MINUTES } from 'src/common/booking/booking-status';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { h3CellsWithinKm } from 'src/common/geo/geo.util';
import { AgentSkillsService } from 'src/agent/skills/skills.service';
import { EligibilityService, pairKey } from './eligibility.service';
import { DbPoolMonitor } from 'src/database/db-pool-monitor.service';
import { HeldJobActions, HeldJobsService } from './held-jobs.service';
import { BOOKING_MODE_SQL, DISPATCH_SCHEMA_SQL } from './dispatch.schema';
import {
  DISPATCH_WAVES,
  EXHAUSTED_RETRY_MINUTES,
  INSTANT_SEARCH_MINUTES,
  NEAR_TERM_MINUTES,
  OFFER_TTL_SECONDS,
  RELEASABLE_STATUSES,
  agentBase,
  canReachInTime,
  distanceKm,
  hasSkillFor,
  minutesUntil,
  serviceNames,
  servesZone,
} from './dispatch.rules';

/** A tick holds a booking this long, so a second instance (or a kick) can't send the same wave twice. */
const LEASE_SECONDS = 30;

/** Bookings advanced per tick; the rest wait for the next one. */
const TICK_BATCH_SIZE = 50;

/** Default in-process tick interval. Vercel can't run timers, so there it's off and a cron calls the endpoint. */
const DEFAULT_TICK_MS = 15_000;

/** Without a timer, app traffic drives dispatch: at most one request per this many seconds runs a tick. */
const DEFAULT_REQUEST_TICK_SECONDS = 20;

/** A request-driven tick advances fewer bookings, so the request it rides on stays quick. */
const REQUEST_TICK_BATCH_SIZE = 10;

/** Wave number used for the one extra chance given to agents who let an offer lapse. */
const RETRY_WAVE = DISPATCH_WAVES.length + 1;

type Candidate = { agent: Agent; distanceKm: number | null; live: boolean };

/**
 * Push dispatch: when a job opens, broadcast it to every eligible agent at
 * once (DISPATCH_WAVES). Each offer lives OFFER_TTL_SECONDS. First accept wins
 * (the conditional claim in AgentBookingsService.accept). If every wave runs
 * dry the job stays in the open pool and is re-checked every few minutes.
 * A "Right now" job still open INSTANT_SEARCH_MINUTES after dispatch started
 * expires instead, and the customer is told to try again.
 *
 * All state is in booking_dispatches / booking_offers, so any instance — the
 * in-process timer, the cron endpoint, or a kick from a request — can drive it.
 */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingDispatch)
    private readonly dispatchRepo: Repository<BookingDispatch>,
    @InjectRepository(BookingOffer)
    private readonly offerRepo: Repository<BookingOffer>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly eligibility: EligibilityService,
    private readonly skills: AgentSkillsService,
    private readonly notifications: NotificationDispatchService,
    private readonly history: BookingHistoryService,
    private readonly dbPool: DbPoolMonitor,
    private readonly closure: BookingClosureService,
    private readonly heldJobs: HeldJobsService,
  ) {}

  async onModuleInit() {
    try {
      await this.bookingRepo.query(BOOKING_MODE_SQL);
    } catch (err) {
      // Booking reads need this column; apply sql/booking_mode_expiry.sql by hand.
      this.logger.error('Failed to ensure bookings.booking_mode', err as Error);
    }
    try {
      await this.bookingRepo.query(DISPATCH_SCHEMA_SQL);
    } catch (err) {
      // Without its tables every tick would fail; say so once instead of every 15 s.
      this.logger.error('Failed to ensure dispatch tables; push dispatch is off', err as Error);
      return;
    }
    const intervalMs = tickIntervalMs();
    if (!intervalMs) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => undefined);
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Hosts without a timer (Vercel, unless a cron calls the tick endpoint) get
   * their ticks from app traffic: agents poll for jobs while online and the
   * customer home screen polls its bookings. At most one request per
   * DISPATCH_REQUEST_TICK_SECONDS, across all instances, runs a small tick
   * before answering. Never throws.
   */
  async tickFromRequest() {
    const seconds = requestTickSeconds();
    if (this.timer || !seconds) return;
    try {
      const won: { id: number }[] = await this.dispatchRepo.query(
        `WITH won AS (
           UPDATE dispatch_clock SET next_tick_at = now() + make_interval(secs => $1)
           WHERE id = 1 AND next_tick_at <= now()
           RETURNING id
         )
         SELECT id FROM won`,
        [seconds],
      );
      if (!won.length) return;
      await this.tick(REQUEST_TICK_BATCH_SIZE);
    } catch (err) {
      this.logger.error('Request-driven dispatch tick failed', err as Error);
    }
  }

  /** One pass: settle offers on jobs that closed elsewhere, then advance every booking that's due. */
  async tick(batchSize = TICK_BATCH_SIZE) {
    if (this.ticking) return { processed: 0 };
    this.ticking = true;
    try {
      await this.step('settle closed jobs', () => this.settleClosedJobs());
      await this.step('release orphaned jobs', () => this.releaseOrphanedJobs());
      await this.step('void unpaid requests', () => this.voidUnpaidRequests());

      const due: { id: string }[] = await this.step('find due bookings', () => this.bookingRepo
        .createQueryBuilder('booking')
        .leftJoin(BookingDispatch, 'dispatch', 'dispatch.bookingId = booking.id')
        .select('booking.id', 'id')
        .where("booking.status = 'paid'")
        .andWhere('booking.agentId IS NULL')
        .andWhere(
          new Brackets((due) =>
            due
              .where('dispatch.bookingId IS NULL')
              // Held by an agent before, released back to the pool since.
              .orWhere("dispatch.status = 'assigned'")
              .orWhere(
                "dispatch.status IN ('searching', 'exhausted') AND dispatch.nextActionAt <= now()",
              ),
          ),
        )
        .orderBy('booking.bookingDate', 'ASC')
        .addOrderBy('booking.startTime', 'ASC')
        .limit(batchSize)
        .getRawMany());

      for (const { id } of due) {
        await this.step(`advance booking ${id}`, () => this.advance(id)).catch(() => undefined);
      }
      // Reminders and no-shows for jobs agents hold but haven't started.
      await this.step('watch held jobs', () => this.heldJobs.sweep(this.heldJobActions())).catch(
        () => undefined,
      );
      return { processed: due.length };
    } finally {
      this.ticking = false;
    }
  }

  /** The customer's "Find another expert" (see HeldJobsService.replaceLateExpert). */
  replaceLateExpert(bookingId: string) {
    return this.heldJobs.replaceLateExpert(bookingId, this.heldJobActions());
  }

  private heldJobActions(): HeldJobActions {
    return {
      release: (bookingId, reason) => this.release(bookingId, reason),
      recordNoShow: (bookingId, agentId) => this.excludeAgent(bookingId, agentId, 'released'),
      closeDispatch: (bookingId) => this.close(bookingId),
    };
  }

  private async step<T>(name: string, run: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const result = await run();
      this.logger.debug(`Tick step "${name}" ok in ${Date.now() - started}ms`);
      return result;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      this.logger.error(
        `Tick step "${name}" failed after ${Date.now() - started}ms: ${e.code ?? ''} ${e.message ?? err} — ${this.dbPool.describe()}`,
      );
      throw err;
    }
  }

  /**
   * Start (or restart) dispatch for an open job right away instead of waiting
   * for the next tick. Never throws — callers are payment/booking flows.
   */
  async kick(bookingId: string) {
    try {
      await this.dispatchRepo
        .createQueryBuilder()
        .insert()
        .values({ bookingId, status: 'searching', wave: 0, nextActionAt: () => 'now()' })
        .orUpdate(['status', 'next_action_at'], ['booking_id'])
        .execute();
      await this.advance(bookingId);
    } catch (err) {
      this.logger.error(`Dispatch kick failed for booking ${bookingId}`, err as Error);
    }
  }

  /** The agent claimed the job (offered or from the open pool): their offer wins, the rest are withdrawn. */
  async onAccepted(bookingId: string, agentId: string) {
    const now = new Date();
    await this.offerRepo.update(
      { bookingId, agentId, status: 'pending' },
      { status: 'accepted', respondedAt: now },
    );
    await this.offerRepo.update(
      { bookingId, status: 'pending' },
      { status: 'cancelled', respondedAt: now },
    );
    await this.dispatchRepo.update({ bookingId }, { status: 'assigned', nextActionAt: null });
  }

  /**
   * The agent passed on the job, or released one they held: never offer it to
   * them again, and move on straight away if nobody else is still deciding.
   */
  async onDeclined(
    bookingId: string,
    agentId: string,
    outcome: 'declined' | 'released' = 'declined',
  ) {
    const now = new Date();
    await this.excludeAgent(bookingId, agentId, outcome);

    // A job handed back by its agent goes straight back out to everyone else.
    if (outcome === 'released') {
      await this.rebroadcast(bookingId);
      return;
    }
    const deciding = await this.offerRepo.count({
      where: { bookingId, status: 'pending', expiresAt: MoreThan(now) },
    });
    if (!deciding) await this.kick(bookingId);
  }

  /**
   * The job moved to a new slot: offers made for the old time no longer mean
   * anything, so withdraw them and start over from wave 1. Agents who
   * explicitly declined stay excluded; everyone else can be asked again.
   */
  async onRescheduled(bookingId: string) {
    await this.rebroadcast(bookingId);
  }

  /**
   * A fresh broadcast: earlier offers are cleared so everyone can be asked
   * again, except agents who declined or handed the job back (those stay out).
   */
  private async rebroadcast(bookingId: string) {
    await this.offerRepo.delete({
      bookingId,
      status: In(['pending', 'expired', 'cancelled']),
    });
    await this.dispatchRepo.update({ bookingId }, { wave: 0 });
    await this.kick(bookingId);
  }

  /**
   * Takes a job back from its agent before work starts — no-show, suspension,
   * or a new time they can't make — and puts it straight back into dispatch.
   * That agent won't be offered it again. Returns false if nothing changed.
   */
  async release(bookingId: string, reason: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['customer', 'agent'],
    });
    const agentId = booking?.agentId;
    if (!booking || !agentId || !RELEASABLE_STATUSES.includes(booking.status)) {
      return false;
    }

    // Conditional, so a concurrent start/complete by the agent wins.
    const released = await this.bookingRepo.update(
      { id: bookingId, agentId, status: In(RELEASABLE_STATUSES) },
      { agentId: null, status: 'paid' },
    );
    if (!released.affected) return false;

    await this.history.record(bookingId, 'paid', null, `Released from agent: ${reason}`);
    await this.excludeAgent(bookingId, agentId, 'released');

    // Back in the pool: a "Right now" job gets a fresh INSTANT_SEARCH_MINUTES to find someone.
    await this.dispatchRepo
      .createQueryBuilder()
      .update()
      .set({ createdAt: () => 'now()' })
      .where('booking_id = :bookingId', { bookingId })
      .execute();
    // Broadcast it again now to everyone it was offered to (bar this agent and decliners).
    await this.rebroadcast(bookingId);
    // Too late to find anyone (it expired straight away): the expiry notice already told the customer.
    const stillOpen =
      (await this.bookingRepo.findOne({ where: { id: bookingId } }))?.status === 'paid';

    const data = { bookingId, bookingNumber: booking.bookingNumber };
    const notices = [
      booking.agent &&
        this.notifications.toUser(booking.agent.userId, {
          app: 'agent',
          title: 'Job removed',
          message: `Booking ${booking.bookingNumber} is no longer assigned to you: ${reason}.`,
          type: 'booking_released',
          data,
        }),
      booking.customer &&
        stillOpen &&
        this.notifications.toUser(booking.customer.userId, {
          app: 'customer',
          title: 'Finding you a new expert',
          message: `Your expert can't make booking ${booking.bookingNumber}, so we're finding someone else.`,
          type: 'booking_released',
          data,
        }),
    ];
    await Promise.all(
      notices.map((notice) =>
        notice?.catch((err) =>
          this.logger.error(`Release notice failed for ${bookingId}`, err as Error),
        ),
      ),
    );
    return true;
  }

  /** Jobs this agent gave back (or no-showed) within the last `days`. */
  recentReleases(agentId: string, days: number) {
    return this.offerRepo.count({
      where: {
        agentId,
        status: 'released',
        respondedAt: MoreThan(new Date(Date.now() - days * 24 * 3600_000)),
      },
    });
  }

  /**
   * When each "Right now" booking's search runs out (dispatch start +
   * INSTANT_SEARCH_MINUTES), so the agent app can drop it from the list then.
   */
  async searchEndsAt(bookingIds: string[]) {
    if (!bookingIds.length) return new Map<string, Date>();
    const rows = await this.dispatchRepo.find({
      where: { bookingId: In(bookingIds) },
      select: ['bookingId', 'createdAt'],
    });
    return new Map(
      rows.map((row) => [
        row.bookingId,
        new Date(row.createdAt.getTime() + INSTANT_SEARCH_MINUTES * 60_000),
      ]),
    );
  }

  /** Live offers for this agent, by booking id → expiry. */
  async pendingOffers(agentId: string) {
    const offers = await this.offerRepo.find({
      where: { agentId, status: 'pending', expiresAt: MoreThan(new Date()) },
    });
    return new Map(offers.map((offer) => [offer.bookingId, offer.expiresAt]));
  }

  /**
   * Approved agents who could take this job within `radiusKm`, nearest first.
   * Distance is from a fresh GPS fix, else the agent's home; zone agents with
   * neither come last. For a job starting soon, only agents with a live fix
   * who can actually get there in time qualify.
   */
  async candidates(
    booking: Booking,
    radiusKm: number,
    excludeAgentIds: string[] = [],
    nextStart?: Date,
  ) {
    const start =
      nextStart ?? (await this.eligibility.nextStarts([booking])).get(booking.id);
    if (!start) return [];
    // A late job (released no-show) still needs someone who can get there fast.
    const minutesToStart = Math.max(0, minutesUntil(start));
    const nearTerm = minutesToStart < NEAR_TERM_MINUTES;

    const zoneId = booking.serviceAreaId;
    const cells = h3CellsWithinKm(
      booking.address?.latitude,
      booking.address?.longitude,
      radiusKm,
    );
    if (!cells.length && !zoneId) return [];

    const query = this.agentRepo
      .createQueryBuilder('agent')
      .where("agent.approvalStatus = 'APPROVED'")
      .andWhere("agent.status <> 'SUSPENDED'")
      .andWhere(
        new Brackets((near) => {
          if (cells.length) {
            near.orWhere(
              '(agent.currentH3Cell IN (:...cells) OR agent.homeH3Cell IN (:...cells))',
              { cells },
            );
          }
          if (zoneId) {
            near.orWhere(
              '(agent.homeZoneId = :zoneId OR CAST(:zoneId AS uuid) = ANY(agent.serviceAreas))',
              { zoneId },
            );
          }
        }),
      );
    if (excludeAgentIds.length) {
      query.andWhere('agent.id NOT IN (:...excludeAgentIds)', { excludeAgentIds });
    }
    const agents = await query.getMany();

    // The H3 cells were a superset: the exact radius decides, unless the
    // agent covers the booking's zone anyway.
    const contexts = await this.skills.matchingContexts(agents.map((agent) => agent.id));
    const reachable: Candidate[] = agents
      .map((agent) => {
        const base = agentBase(agent);
        return {
          agent,
          live: base?.live ?? false,
          distanceKm: distanceKm(base?.point ?? null, booking.address),
        };
      })
      .filter(
        ({ agent, distanceKm: km }) =>
          servesZone(agent, zoneId) || (km !== null && km <= radiusKm),
      )
      .filter(
        ({ live, distanceKm: km }) =>
          !nearTerm || (live && km !== null && canReachInTime(km, minutesToStart)),
      )
      .filter(({ agent }) =>
        hasSkillFor(booking, contexts.get(agent.id)?.keywords ?? []),
      );

    const blocked = await this.eligibility.conflictPairs(
      reachable.map(({ agent }) => agent.id),
      [booking],
    );
    return reachable
      .filter(({ agent }) => !blocked.has(pairKey(agent.id, booking.id)))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  /** Moves one booking's dispatch forward: wait on live offers, send the next wave, or give up for now. */
  private async advance(bookingId: string) {
    await this.dispatchRepo
      .createQueryBuilder()
      .insert()
      .values({ bookingId, status: 'searching', wave: 0, nextActionAt: () => 'now()' })
      .orIgnore()
      .execute();

    const lease = await this.dispatchRepo
      .createQueryBuilder()
      .update()
      .set({ nextActionAt: () => `now() + interval '${LEASE_SECONDS} seconds'` })
      .where('booking_id = :bookingId', { bookingId })
      .andWhere(
        "(status = 'assigned' OR (status IN ('searching', 'exhausted') AND (next_action_at IS NULL OR next_action_at <= now())))",
      )
      .returning(['status', 'wave', 'createdAt'])
      .execute();
    if (!lease.affected) return;
    const state = (
      lease.raw as (Pick<BookingDispatch, 'status' | 'wave'> & { created_at: Date })[]
    )[0];

    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['address', 'items', 'items.service'],
    });
    const now = new Date();
    if (!booking || booking.status !== 'paid' || booking.agentId) {
      await this.settle(bookingId, booking);
      return;
    }
    const nextStart = (await this.eligibility.nextStarts([booking], now)).get(bookingId);
    const searchEndsAt =
      booking.bookingMode === 'INSTANT'
        ? new Date(new Date(state.created_at).getTime() + INSTANT_SEARCH_MINUTES * 60_000)
        : null;
    if (searchEndsAt && (!nextStart || now >= searchEndsAt)) {
      await this.expire(booking);
      return;
    }
    if (!nextStart) {
      await this.close(bookingId);
      return;
    }

    const offers = await this.offerRepo.find({ where: { bookingId } });
    const overdue = offers.filter(
      (offer) => offer.status === 'pending' && offer.expiresAt <= now,
    );
    if (overdue.length) {
      await this.offerRepo.update(
        { id: In(overdue.map((offer) => offer.id)) },
        { status: 'expired' },
      );
      for (const offer of overdue) offer.status = 'expired';
    }
    const live = offers.filter(
      (offer) => offer.status === 'pending' && offer.expiresAt > now,
    );
    if (live.length) {
      const firstExpiry = Math.min(...live.map((offer) => offer.expiresAt.getTime()));
      await this.dispatchRepo.update(
        { bookingId },
        { status: 'searching', nextActionAt: new Date(firstExpiry) },
      );
      return;
    }

    // Everyone already asked (or who passed) is out. An exhausted job re-runs
    // the widest wave for agents who came online since, and gives those who
    // let an offer lapse (or had it withdrawn) one more chance — never a third.
    const retrying = state.status === 'exhausted';
    const askAgain = retrying
      ? offers.filter(
          (offer) =>
            ['expired', 'cancelled'].includes(offer.status) &&
            offer.wave < RETRY_WAVE,
        )
      : [];
    const asked = offers
      .filter((offer) => !askAgain.includes(offer))
      .map((offer) => offer.agentId);
    const waves = retrying
      ? [{ wave: RETRY_WAVE, ...DISPATCH_WAVES[DISPATCH_WAVES.length - 1] }]
      : DISPATCH_WAVES.map((spec, index) => ({ wave: index + 1, ...spec })).slice(
          state.wave,
        );

    for (const { wave, radiusKm, size } of waves) {
      const picks = (await this.candidates(booking, radiusKm, asked, nextStart)).slice(
        0,
        size,
      );
      if (!picks.length) continue;

      const again = picks.filter((pick) =>
        askAgain.some((offer) => offer.agentId === pick.agent.id),
      );
      if (again.length) {
        await this.offerRepo.delete({
          bookingId,
          agentId: In(again.map((pick) => pick.agent.id)),
        });
      }

      const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);
      await this.offerRepo
        .createQueryBuilder()
        .insert()
        .values(
          picks.map((pick) => ({
            bookingId,
            agentId: pick.agent.id,
            wave,
            status: 'pending' as const,
            distanceKm: pick.distanceKm === null ? null : pick.distanceKm.toFixed(2),
            expiresAt,
          })),
        )
        .orIgnore()
        .execute();
      await this.dispatchRepo.update(
        { bookingId },
        {
          status: 'searching',
          wave: Math.min(wave, DISPATCH_WAVES.length),
          nextActionAt: expiresAt,
        },
      );
      await this.notifyOffers(booking, picks, expiresAt);
      return;
    }

    const retryAt = new Date(now.getTime() + EXHAUSTED_RETRY_MINUTES * 60_000);
    await this.dispatchRepo.update(
      { bookingId },
      {
        status: 'exhausted',
        wave: DISPATCH_WAVES.length,
        // A "Right now" job must be looked at again when its search runs out.
        nextActionAt: searchEndsAt && searchEndsAt < retryAt ? searchEndsAt : retryAt,
      },
    );
    if (state.status !== 'exhausted') {
      this.logger.warn(
        `No agent took booking ${booking.bookingNumber} from the broadcast; it stays in the open pool`,
      );
    }
  }

  /** Booking requests nobody paid for within PAYMENT_WINDOW_MINUTES: never confirmed, so voided. */
  private async voidUnpaidRequests() {
    const rows: { id: string }[] = await this.bookingRepo
      .createQueryBuilder('booking')
      .select('booking.id', 'id')
      .where("booking.status = 'finding'")
      .andWhere(`booking.createdAt < now() - make_interval(mins => :minutes)`, {
        minutes: PAYMENT_WINDOW_MINUTES,
      })
      .limit(TICK_BATCH_SIZE)
      .getRawMany();
    for (const { id } of rows) {
      await this.closure
        .close(id, 'cancelled', {
          reason: 'BOOKING_CANCELLED',
          remarks: `Payment not completed within ${PAYMENT_WINDOW_MINUTES} minutes`,
          onlyIf: (locked) => locked.status === 'finding',
        })
        .catch((err) => this.logger.error(`Voiding unpaid request ${id} failed`, err as Error));
    }
  }

  /** Jobs held by an agent who has since been suspended or lost approval — they can no longer act on them. */
  private async releaseOrphanedJobs() {
    const rows: { id: string }[] = await this.bookingRepo
      .createQueryBuilder('booking')
      .innerJoin('booking.agent', 'agent')
      .select('booking.id', 'id')
      .where('booking.status IN (:...releasable)', { releasable: RELEASABLE_STATUSES })
      .andWhere("(agent.status = 'SUSPENDED' OR agent.approvalStatus <> 'APPROVED')")
      .limit(TICK_BATCH_SIZE)
      .getRawMany();
    for (const { id } of rows) {
      await this.release(id, 'the agent account is no longer active').catch((err) =>
        this.logger.error(`Orphan release failed for ${id}`, err as Error),
      );
    }
  }

  /** Records that this agent is out for this booking, whatever their offer said before. */
  private async excludeAgent(
    bookingId: string,
    agentId: string,
    outcome: 'declined' | 'released' = 'declined',
  ) {
    const now = new Date();
    await this.offerRepo
      .createQueryBuilder()
      .insert()
      .values({ bookingId, agentId, wave: 0, status: outcome, expiresAt: now, respondedAt: now })
      .orUpdate(['status', 'responded_at'], ['booking_id', 'agent_id'])
      .execute();
  }

  /** Bookings that were assigned, cancelled or released elsewhere while offers were still out. */
  private async settleClosedJobs() {
    const rows: { bookingId: string }[] = await this.offerRepo
      .createQueryBuilder('offer')
      .innerJoin('offer.booking', 'booking')
      .select('DISTINCT offer.bookingId', 'bookingId')
      .where("offer.status = 'pending'")
      .andWhere("(booking.status <> 'paid' OR booking.agentId IS NOT NULL)")
      .getRawMany();
    for (const { bookingId } of rows) {
      const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
      await this.settle(bookingId, booking);
    }
  }

  private async settle(bookingId: string, booking: Booking | null) {
    if (booking?.agentId) {
      await this.onAccepted(bookingId, booking.agentId);
      return;
    }
    await this.close(bookingId);
  }

  /**
   * Nobody took a "Right now" job in time: it expires, what the customer paid
   * goes back to their wallet, and they're asked to try again.
   */
  private async expire(booking: Booking) {
    // One transaction with the booking row locked, so an accept racing this tick wins.
    const closed = await this.closure.close(booking.id, 'expired', {
      reason: 'BOOKING_EXPIRED',
      remarks: `No agent accepted within ${INSTANT_SEARCH_MINUTES} minutes`,
      onlyIf: (locked) => locked.status === 'paid' && !locked.agentId,
    });
    if (!closed) {
      await this.settle(booking.id, await this.bookingRepo.findOne({ where: { id: booking.id } }));
      return;
    }
    const { refundedToWallet, releasedCoupons } = closed;
    await this.close(booking.id);

    const withCustomer = await this.bookingRepo.findOne({
      where: { id: booking.id },
      relations: ['customer'],
    });
    if (!withCustomer?.customer) return;
    await this.notifications
      .toUser(withCustomer.customer.userId, {
        app: 'customer',
        title: 'No expert available right now',
        message: `Sorry, no expert is available at the moment for booking ${booking.bookingNumber}.${
          refundedToWallet > 0 ? ` ₹${refundedToWallet} has been added to your wallet.` : ''
        }${couponNote(releasedCoupons)} Please try again in a little while.`,
        type: 'booking_expired',
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      })
      .catch((err) =>
        this.logger.error(`Expiry notice failed for ${booking.id}`, err as Error),
      );
  }

  private async close(bookingId: string) {
    await this.offerRepo.update(
      { bookingId, status: 'pending' },
      { status: 'cancelled', respondedAt: new Date() },
    );
    await this.dispatchRepo.update({ bookingId }, { status: 'closed', nextActionAt: null });
  }

  private async notifyOffers(booking: Booking, picks: Candidate[], expiresAt: Date) {
    const what = serviceNames(booking)[0] ?? 'New job';
    const when = `${String(booking.bookingDate).slice(0, 10)} at ${booking.startTime.slice(0, 5)}`;
    await Promise.all(
      picks.map(({ agent, distanceKm: km }) =>
        this.notifications
          .toUser(agent.userId, {
            app: 'agent',
            title: 'New job near you',
            message: `${what} on ${when}${km === null ? '' : ` · ${km.toFixed(1)} km away`}. Accept within ${OFFER_TTL_SECONDS}s.`,
            type: 'job_offer',
            data: {
              bookingId: booking.id,
              bookingNumber: booking.bookingNumber,
              expiresAt: expiresAt.toISOString(),
            },
          })
          .catch((err) =>
            this.logger.error(`Offer push failed for agent ${agent.id}`, err as Error),
          ),
      ),
    );
  }
}

function requestTickSeconds() {
  const raw = process.env.DISPATCH_REQUEST_TICK_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_REQUEST_TICK_SECONDS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function tickIntervalMs() {
  const raw = process.env.DISPATCH_TICK_MS;
  if (raw !== undefined && raw !== '') {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return process.env.VERCEL ? 0 : DEFAULT_TICK_MS;
}
