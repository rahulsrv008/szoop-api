import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import {
  AgentLocation,
  AgentMissedJob,
  Booking,
  BookingStatusHistory,
  BookingVisit,
  SupportTicket,
} from 'src/database/entities';
import type { MissedJobReason } from 'src/database/entities';
import { haversineKm } from 'src/common/geo/geo.util';
import { BookingClosureService, couponNote } from 'src/common/booking/booking-closure.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { addressPoint, serviceNames } from './dispatch.rules';

/** "Start heading to the customer" goes out this long before the slot. */
export const REMINDER_MINUTES_BEFORE = 60;
/** A held job whose agent hasn't tapped "I'm on my way" this long before the slot is handed to someone else… */
export const ON_THE_WAY_CUTOFF_MINUTES = 15;
/** …but never sooner than this after they accepted it (a "Right now" job is accepted after that point). */
export const MIN_MINUTES_AFTER_ACCEPT = 15;
/** The last nudge comes this long before that cut-off, so it can still be acted on. */
export const WARNING_MINUTES_BEFORE_CUTOFF = 10;
/** An agent on the way who hasn't started the job (customer OTP) this long after the slot is a no-show. */
export const START_GRACE_MINUTES = 30;
/** Only slots this recent are acted on, so a deploy doesn't sweep up weeks-old missed jobs at once. */
export const WATCH_LOOKBACK_HOURS = 3;
/** "Right now" jobs: this long after setting off, the agent should be closer to the customer… */
export const MOVING_CHECK_MINUTES = 10;
/** …by at least this much (lenient: traffic, parking, GPS drift), unless already this close. */
export const MIN_PROGRESS_KM = 0.3;
export const NEAR_CUSTOMER_KM = 0.3;
/** A location update older than this means the app isn't reporting (no internet, app closed). */
export const FRESH_LOCATION_MINUTES = 5;
/** A job taken back from an agent who didn't move gets a new start this far ahead, so others can take it. */
export const REDISPATCH_LEAD_MINUTES = 15;

/** What only DispatchService can do; passed in so this service doesn't depend on it. */
export type HeldJobActions = {
  /** Take the job off its agent and put it back into dispatch; false if it had moved on. */
  release: (bookingId: string, reason: string) => Promise<boolean>;
  /** Count a no-show against the agent's monthly release limit (and never offer them this job again). */
  recordNoShow: (bookingId: string, agentId: string) => Promise<void>;
  /** Withdraw any offers and stop dispatching a job that just closed. */
  closeDispatch: (bookingId: string) => Promise<void>;
};

type Kind =
  | 'reminder'
  | 'warning'
  | 'released'
  | 'closed'
  | 'cancelled'
  | 'plan_missed'
  | 'not_moving'
  | 'no_location'
  | 'replaced';

type Held = {
  booking: Booking;
  /** The slot being watched: a single job's start, or a plan's next visit. */
  slot: Date;
  plan: boolean;
  /** When the agent last accepted it (a plan goes back to accepted after each visit). */
  acceptedAt: Date | null;
  /** When they last tapped "I'm on my way" (or accepted a "Right now" job, which does both). */
  arrivingAt: Date | null;
};

const minutes = (n: number) => n * 60_000;

/**
 * Watches jobs an agent holds but hasn't started, on every dispatch tick:
 *
 * - a reminder an hour before the slot, and a last nudge 10 minutes before the cut-off;
 * - no "I'm on my way" 15 minutes before the slot (or 15 minutes after a late accept):
 *   the job goes back to dispatch, which counts against the agent's release limit;
 *   if nobody takes it by the slot, it closes and the customer is refunded to their wallet;
 * - "Right now" jobs, 10 minutes after setting off: no closer to the customer, so back to
 *   dispatch with a new start 15 minutes ahead; no location coming in at all (no internet,
 *   or the app is behind Google Maps), so the agent is asked, but nothing is taken away;
 * - on the way but not started 30 minutes after the slot: cancelled and refunded;
 * - a plan visit is never released or cancelled automatically (the plan runs for weeks):
 *   a missed visit is flagged to the admin, agent and customer instead.
 *
 * The admin hears about every no-show as a high-priority support ticket on the booking.
 * Each step is claimed once in booking_job_alerts, so concurrent ticks never repeat one.
 */
@Injectable()
export class HeldJobsService {
  private readonly logger = new Logger(HeldJobsService.name);

  constructor(
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingVisit) private readonly visitRepo: Repository<BookingVisit>,
    @InjectRepository(BookingStatusHistory)
    private readonly historyRepo: Repository<BookingStatusHistory>,
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(AgentLocation) private readonly locationRepo: Repository<AgentLocation>,
    @InjectRepository(AgentMissedJob) private readonly missedRepo: Repository<AgentMissedJob>,
    private readonly closure: BookingClosureService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  async sweep(actions: HeldJobActions, now = new Date()) {
    for (const held of await this.heldJobs(now)) {
      await this.check(held, actions, now).catch((err) =>
        this.logger.error(`Held-job check failed for ${held.booking.id}`, err as Error),
      );
    }
    await this.closeUnclaimed(actions, now);
  }

  private async check(held: Held, actions: HeldJobActions, now: Date) {
    const { booking, slot, plan } = held;
    const t = now.getTime();
    const cutoff = Math.max(
      slot.getTime() - minutes(ON_THE_WAY_CUTOFF_MINUTES),
      held.acceptedAt ? held.acceptedAt.getTime() + minutes(MIN_MINUTES_AFTER_ACCEPT) : -Infinity,
    );
    const warnAt = cutoff - minutes(WARNING_MINUTES_BEFORE_CUTOFF);
    const remindAt = slot.getTime() - minutes(REMINDER_MINUTES_BEFORE);
    const acceptedBefore = (at: number) => !held.acceptedAt || held.acceptedAt.getTime() <= at;
    const startDeadline = slot.getTime() + minutes(START_GRACE_MINUTES);

    if (plan) {
      if (t >= startDeadline) return this.planMissed(held);
      if (booking.status !== 'accepted') return;
      if (t >= warnAt && t < slot.getTime() && acceptedBefore(warnAt)) return this.nudge(held, 'warning');
      if (t >= remindAt && t < warnAt && acceptedBefore(remindAt)) return this.nudge(held, 'reminder');
      return;
    }

    if (booking.status === 'arriving') {
      if (t >= startDeadline) return this.cancelNoShow(held, actions);
      if (
        booking.bookingMode === 'INSTANT' &&
        held.arrivingAt &&
        t >= held.arrivingAt.getTime() + minutes(MOVING_CHECK_MINUTES)
      ) {
        await this.checkMoving(held, actions, now);
      }
      return;
    }
    if (t >= cutoff) return this.releaseNoShow(held, actions, cutoff);
    if (t >= warnAt && acceptedBefore(warnAt)) return this.nudge(held, 'warning');
    if (t >= remindAt && acceptedBefore(remindAt)) return this.nudge(held, 'reminder');
  }

  // ------------------------------------------------------------- the steps

  private async nudge(held: Held, kind: 'reminder' | 'warning') {
    const { booking, slot, plan } = held;
    if (!(await this.claim(booking.id, booking.agentId as string, slot, kind))) return;
    const what = `${jobName(booking)} at ${clock(slot)} (${booking.bookingNumber})`;
    const notice =
      kind === 'reminder'
        ? {
            title: 'Start heading to the customer',
            message: `${what} starts in about an hour. Tap "I'm on my way" when you leave.`,
          }
        : plan
          ? {
              title: 'Time to head out',
              message: `${what} starts soon. Tap "I'm on my way" when you leave.`,
            }
          : {
              title: `Tap "I'm on my way" now`,
              message: `${what}: if you haven't set off within ${WARNING_MINUTES_BEFORE_CUTOFF} minutes, the job goes to another expert.`,
            };
    await this.tellAgent(booking, { ...notice, type: 'job_reminder' });
  }

  /** No "I'm on my way" by the cut-off: back to dispatch (DispatchService tells the agent and customer). */
  private async releaseNoShow(held: Held, actions: HeldJobActions, cutoff: number) {
    const { booking, slot } = held;
    const agentId = booking.agentId as string;
    if (!(await this.claim(booking.id, agentId, slot, 'released'))) return;
    const released = await actions.release(
      booking.id,
      `you didn't tap "I'm on my way" by ${clock(new Date(cutoff))}`,
    );
    if (!released) return; // They set off or started at the last moment.
    await this.ticket(
      booking,
      'NO_ON_THE_WAY',
      slot,
      `The assigned expert hadn't tapped "I'm on my way" by ${clock(new Date(cutoff))} for the ${clock(slot)} slot. ` +
        'The job went back to dispatch; if nobody takes it by the slot it closes and the customer is refunded to their wallet.',
    );
  }

  /**
   * A "Right now" agent 10 minutes into the trip: compares where they set off
   * from with their latest location. Not moving: the job goes to someone
   * else. No location at all: never treated as a no-show (a phone without
   * internet, or one navigating in Google Maps, looks the same), so the agent is asked.
   */
  private async checkMoving(held: Held, actions: HeldJobActions, now: Date) {
    const { booking, slot } = held;
    const agentId = booking.agentId as string;
    const destination = addressPoint(booking.address);
    const arrivingAt = held.arrivingAt as Date;
    if (!destination) return;

    const [origin, latest] = await Promise.all([
      // Where they were as they set off: the last update up to a minute after tapping.
      this.locationRepo
        .createQueryBuilder('ping')
        .where('ping.agentId = :agentId', { agentId })
        .andWhere('ping.recordedAt <= :until', { until: new Date(arrivingAt.getTime() + minutes(1)) })
        .andWhere('ping.recordedAt >= :since', { since: new Date(arrivingAt.getTime() - minutes(30)) })
        .orderBy('ping.recordedAt', 'DESC')
        .getOne(),
      this.locationRepo
        .createQueryBuilder('ping')
        .where('ping.agentId = :agentId', { agentId })
        .andWhere('ping.recordedAt > :after', { after: new Date(arrivingAt.getTime() + minutes(2)) })
        .orderBy('ping.recordedAt', 'DESC')
        .getOne(),
    ]);
    const away = (ping: AgentLocation) =>
      haversineKm(Number(ping.latitude), Number(ping.longitude), destination.latitude, destination.longitude);

    const fresh = latest && latest.recordedAt.getTime() >= now.getTime() - minutes(FRESH_LOCATION_MINUTES);
    if (!origin || !fresh) return this.noLocation(held);

    const before = away(origin);
    const nowAway = away(latest);
    if (nowAway <= NEAR_CUSTOMER_KM || nowAway <= before - MIN_PROGRESS_KM) return;

    if (!(await this.claim(booking.id, agentId, slot, 'not_moving'))) return;
    const restart = await this.redispatch(
      booking,
      actions,
      now,
      `you hadn't moved towards the customer ${MOVING_CHECK_MINUTES} minutes after setting off`,
    );
    if (!restart) return;
    await this.ticket(
      booking,
      'NOT_MOVING',
      slot,
      `"Right now" job: ${MOVING_CHECK_MINUTES} minutes after setting off the expert was ${nowAway.toFixed(1)} km from the customer ` +
        `(${before.toFixed(1)} km when they set off). It went back to dispatch with a new start of ${clock(restart)}.`,
    );
  }

  /**
   * On the way, but the phone hasn't reported a location: ask, no penalty. No
   * admin ticket either: the app only reports while it's on screen, so an
   * agent navigating with Google Maps looks like this on most trips. The
   * admin hears if the job then isn't started in time (cancelNoShow).
   */
  private async noLocation(held: Held) {
    const { booking, slot } = held;
    if (!(await this.claim(booking.id, booking.agentId as string, slot, 'no_location'))) return;
    await this.tellAgent(booking, {
      title: "We can't see your location",
      message: `Booking ${booking.bookingNumber}: open the app now and then so the customer can follow you. Call support if something's wrong.`,
      type: 'job_reminder',
    });
  }

  /**
   * The customer's "Find another expert": allowed once the slot has passed and
   * the expert still hasn't started. Same as a no-show release: counted against
   * the expert, a new start 15 minutes ahead, and a refund if nobody takes it.
   * Plans are excluded (they have "change cook").
   */
  async replaceLateExpert(bookingId: string, actions: HeldJobActions, now = new Date()) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['agent', 'customer', 'address', 'items', 'items.service'],
    });
    if (!booking) return { ok: false as const, reason: 'not_found' as const };
    const hasVisits = (await this.visitRepo.count({ where: { bookingId } })) > 0;
    if (!canReplaceExpert(booking, hasVisits, now)) return { ok: false as const, reason: 'not_late' as const };

    const agentId = booking.agentId as string;
    const slot = slotOf(booking.bookingDate, booking.startTime);
    // A double tap (or two devices) replaces the expert once.
    if (!(await this.claim(booking.id, agentId, slot, 'replaced'))) {
      return { ok: false as const, reason: 'already' as const };
    }
    const restart = await this.redispatch(
      booking,
      actions,
      now,
      'the customer asked for another expert because you were running late',
    );
    if (!restart) return { ok: false as const, reason: 'moved_on' as const };
    await this.ticket(
      booking,
      'CUSTOMER_REPLACED',
      slot,
      `The customer asked for another expert: the ${clock(slot)} job hadn't been started ` +
        `(${booking.status === 'arriving' ? 'expert on the way' : 'expert hadn\'t set off'}). It went back to dispatch with a new start of ${clock(restart)}.`,
    );
    return { ok: true as const, newStart: restart };
  }

  /**
   * Takes a single job off its expert and back into dispatch with a new start
   * REDISPATCH_LEAD_MINUTES ahead (open jobs close at their start, so the old
   * one would leave nobody able to take it). Recorded as released, so
   * closeUnclaimed refunds the customer if nobody takes it by then. Returns
   * the new start, or null if the job had moved on (started, cancelled).
   */
  private async redispatch(booking: Booking, actions: HeldJobActions, now: Date, reason: string) {
    const agentId = booking.agentId as string;
    const original = { bookingDate: booking.bookingDate, startTime: booking.startTime };
    const restart = nextFiveMinutes(new Date(now.getTime() + minutes(REDISPATCH_LEAD_MINUTES)));
    await this.bookingRepo.update(
      { id: booking.id, agentId, status: In(['accepted', 'arriving']) },
      { bookingDate: localDate(restart), startTime: timeOf(restart) },
    );
    const released = await actions.release(booking.id, reason);
    if (!released) {
      // They started (or it moved on) in the meantime: keep its real time.
      await this.bookingRepo.update({ id: booking.id, agentId }, original);
      return null;
    }
    await this.claim(booking.id, agentId, restart, 'released');
    return restart;
  }

  /** On the way but never started: cancelled, refunded, and counted against the agent. */
  private async cancelNoShow(held: Held, actions: HeldJobActions) {
    const { booking, slot } = held;
    const agentId = booking.agentId as string;
    if (!(await this.claim(booking.id, agentId, slot, 'cancelled'))) return;
    const closed = await this.closure.close(booking.id, 'cancelled', {
      reason: 'BOOKING_CANCELLED',
      remarks: `Expert did not start the job within ${START_GRACE_MINUTES} minutes of the slot`,
      onlyIf: (locked) => locked.agentId === agentId && ['accepted', 'arriving'].includes(locked.status),
    });
    if (!closed) return;
    await actions.recordNoShow(booking.id, agentId);
    await actions.closeDispatch(booking.id);

    await Promise.all([
      this.tellAgent(booking, {
        title: 'Booking cancelled',
        message: `Booking ${booking.bookingNumber} was cancelled: it wasn't started within ${START_GRACE_MINUTES} minutes of ${clock(slot)}. This counts as a missed job.`,
        type: 'booking_cancelled',
      }),
      this.tellCustomer(booking, {
        title: 'Booking cancelled',
        message: `Sorry, your expert couldn't start booking ${booking.bookingNumber}.${refundNote(closed)} Please book again whenever you like.`,
        type: 'booking_cancelled',
      }),
      this.ticket(
        booking,
        'NOT_STARTED',
        slot,
        `The expert tapped "I'm on my way" but hadn't started the job (customer OTP) ${START_GRACE_MINUTES} minutes after the ${clock(slot)} slot. ` +
          `It was cancelled automatically${closed.refundedToWallet > 0 ? ` and ₹${closed.refundedToWallet} refunded to the customer's wallet` : ''}.`,
      ),
    ]);
  }

  /** A plan visit never started: flagged only, the plan carries on. */
  private async planMissed(held: Held) {
    const { booking, slot } = held;
    if (!(await this.claim(booking.id, booking.agentId as string, slot, 'plan_missed'))) return;
    await Promise.all([
      this.tellAgent(booking, {
        title: 'Visit missed',
        message: `The ${clock(slot)} visit for ${booking.bookingNumber} wasn't started. Contact support if you're running late.`,
        type: 'plan_visit_missed',
      }),
      this.tellCustomer(booking, {
        title: 'Your visit is running late',
        message: `Your ${clock(slot)} visit for ${booking.bookingNumber} hasn't started yet. Our team has been told and will get in touch.`,
        type: 'plan_visit_missed',
      }),
      this.ticket(
        booking,
        'PLAN_VISIT_MISSED',
        slot,
        `Plan visit at ${clock(slot)} on ${localDate(slot)} wasn't started within ${START_GRACE_MINUTES} minutes. ` +
          'Plans are never released or cancelled automatically: please contact the expert and the customer.',
      ),
    ]);
  }

  /**
   * A job released for a no-show that nobody took before its slot: dispatch has
   * stopped looking, so close it and refund the customer to their wallet.
   */
  private async closeUnclaimed(actions: HeldJobActions, now: Date) {
    const rows: { booking_id: string; agent_id: string; slot: Date }[] = await this.bookingRepo.query(
      `SELECT a.booking_id, a.agent_id, a.slot
         FROM booking_job_alerts a
         JOIN bookings b ON b.id = a.booking_id
        WHERE a.kind = 'released'
          AND a.slot <= $1
          AND b.status = 'paid'
          AND b.agent_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM booking_job_alerts c WHERE c.booking_id = a.booking_id AND c.kind = 'closed'
          )`,
      [now],
    );
    for (const row of rows) {
      try {
        if (!(await this.claim(row.booking_id, row.agent_id, new Date(row.slot), 'closed'))) continue;
        const closed = await this.closure.close(row.booking_id, 'expired', {
          reason: 'BOOKING_EXPIRED',
          remarks: 'No expert could take over after the assigned expert did not set off',
          onlyIf: (locked) => locked.status === 'paid' && !locked.agentId,
        });
        if (!closed) continue;
        await actions.closeDispatch(row.booking_id);
        const booking = await this.bookingRepo.findOne({
          where: { id: row.booking_id },
          relations: ['customer'],
        });
        if (!booking) continue;
        await this.tellCustomer(booking, {
          title: 'No expert available',
          message: `Sorry, no expert could make it to booking ${booking.bookingNumber}.${refundNote(closed)} Please book again whenever you like.`,
          type: 'booking_expired',
        });
      } catch (err) {
        this.logger.error(`Closing released no-show ${row.booking_id} failed`, err as Error);
      }
    }
  }

  // -------------------------------------------------------------- the data

  /** Jobs held but not started, whose slot is between WATCH_LOOKBACK_HOURS ago and just over an hour ahead. */
  private async heldJobs(now: Date): Promise<Held[]> {
    const from = new Date(now.getTime() - WATCH_LOOKBACK_HOURS * 3_600_000);
    const to = new Date(now.getTime() + minutes(REMINDER_MINUTES_BEFORE + 1));
    const inWindow = (slot: Date) => slot >= from && slot <= to;
    const dates = Between(localDate(from), localDate(to));
    const relations = ['agent', 'customer', 'address', 'items', 'items.service'];

    const singles = await this.bookingRepo.find({
      where: { status: In(['accepted', 'arriving']), agentId: Not(IsNull()), bookingDate: dates },
      relations,
    });
    const visitsInWindow = await this.visitRepo
      .createQueryBuilder('visit')
      .innerJoin('visit.booking', 'booking')
      .select('DISTINCT visit.bookingId', 'bookingId')
      .where("visit.status IN ('pending', 'active')")
      .andWhere('visit.visitDate BETWEEN :from AND :to', { from: localDate(from), to: localDate(to) })
      .andWhere("booking.status IN ('accepted', 'arriving')")
      .andWhere('booking.agentId IS NOT NULL')
      .getRawMany<{ bookingId: string }>();

    const planIds = new Set(visitsInWindow.map((row) => row.bookingId));
    const singleIds = singles.map((booking) => booking.id);
    // A booking with visits is a plan even when its own date is in the window.
    const withVisits = singleIds.length
      ? await this.visitRepo
          .createQueryBuilder('visit')
          .select('DISTINCT visit.bookingId', 'bookingId')
          .where('visit.bookingId IN (:...ids)', { ids: singleIds })
          .getRawMany<{ bookingId: string }>()
      : [];
    const isPlan = new Set(withVisits.map((row) => row.bookingId));

    const held: Held[] = [];
    for (const booking of singles) {
      if (isPlan.has(booking.id)) continue;
      const slot = slotOf(booking.bookingDate, booking.startTime);
      if (inWindow(slot)) held.push({ booking, slot, plan: false, acceptedAt: null, arrivingAt: null });
    }

    if (planIds.size) {
      const plans = await this.bookingRepo.find({ where: { id: In([...planIds]) }, relations });
      const visits = await this.visitRepo.find({
        where: { bookingId: In([...planIds]), status: In(['pending', 'active']) },
        order: { visitDate: 'ASC', startTime: 'ASC' },
      });
      for (const booking of plans) {
        // The next visit still to do; one missed long ago stops it being watched (the admin has it).
        const next = visits.find((visit) => visit.bookingId === booking.id);
        if (!next) continue;
        const slot = slotOf(next.visitDate, next.startTime);
        if (inWindow(slot)) held.push({ booking, slot, plan: true, acceptedAt: null, arrivingAt: null });
      }
    }

    const ids = held.map((job) => job.booking.id);
    if (ids.length) {
      const changes = await this.historyRepo.find({
        where: { bookingId: In(ids), status: In(['accepted', 'arriving']) },
        order: { createdAt: 'DESC' },
      });
      const latest = (bookingId: string, status: string) =>
        changes.find((row) => row.bookingId === bookingId && row.status === status)?.createdAt ?? null;
      for (const job of held) {
        job.acceptedAt = latest(job.booking.id, 'accepted');
        job.arrivingAt = latest(job.booking.id, 'arriving');
      }
    }
    return held;
  }

  /** True for the one caller that records this step first. */
  private async claim(bookingId: string, agentId: string, slot: Date, kind: Kind) {
    const rows: unknown[] = await this.bookingRepo.query(
      `INSERT INTO booking_job_alerts (booking_id, agent_id, slot, kind)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING booking_id`,
      [bookingId, agentId, slot, kind],
    );
    return rows.length > 0;
  }

  private async tellAgent(booking: Booking, notice: { title: string; message: string; type: string }) {
    if (!booking.agent) return;
    await this.notifications
      .toUser(booking.agent.userId, {
        app: 'agent',
        ...notice,
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      })
      .catch((err) => this.logger.error(`Agent notice failed for ${booking.id}`, err as Error));
  }

  private async tellCustomer(booking: Booking, notice: { title: string; message: string; type: string }) {
    if (!booking.customer) return;
    await this.notifications
      .toUser(booking.customer.userId, {
        app: 'customer',
        ...notice,
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      })
      .catch((err) => this.logger.error(`Customer notice failed for ${booking.id}`, err as Error));
  }

  /**
   * Every no-show is recorded for the admin panel's Missed jobs page, and
   * raised as one high-priority ticket in the support queue.
   */
  private async ticket(booking: Booking, reason: MissedJobReason, slot: Date, description: string) {
    if (!booking.agent) return;
    await this.missedRepo
      .createQueryBuilder()
      .insert()
      .values({ agentId: booking.agent.id, bookingId: booking.id, reason, slot, details: description })
      .orIgnore()
      .execute()
      .catch((err) => this.logger.error(`Missed-job record failed for ${booking.id}`, err as Error));
    const agentName = [booking.agent.firstName, booking.agent.lastName].filter(Boolean).join(' ');
    await this.ticketRepo
      .save(
        this.ticketRepo.create({
          userId: booking.agent.userId,
          app: 'agent',
          bookingId: booking.id,
          subject: `Missed job · ${booking.bookingNumber}`,
          description: `${agentName ? `Expert: ${agentName}. ` : ''}${description}`,
          priority: 'HIGH',
          status: 'OPEN',
        }),
      )
      .catch((err) => this.logger.error(`No-show ticket failed for ${booking.id}`, err as Error));
  }
}

/**
 * Whether the customer may ask for another expert: a single job (not a plan)
 * held by an expert who hasn't started it, and its start time has passed.
 */
export function canReplaceExpert(booking: Booking, hasVisits: boolean, now = new Date()) {
  if (hasVisits || !booking.agentId || !['accepted', 'arriving'].includes(booking.status)) return false;
  return slotOf(booking.bookingDate, booking.startTime).getTime() <= now.getTime();
}

function jobName(booking: Booking) {
  return booking.planTitle || serviceNames(booking)[0] || 'Your job';
}

function refundNote(closed: { refundedToWallet: number; releasedCoupons: string[] }) {
  return `${closed.refundedToWallet > 0 ? ` ₹${closed.refundedToWallet} has been added to your wallet.` : ''}${couponNote(closed.releasedCoupons)}`;
}

/** A slot in local (India) time; Postgres `date` may come back as 'YYYY-MM-DD' or a Date. */
function slotOf(date: string | Date, time: string) {
  const day = typeof date === 'string' ? date.slice(0, 10) : localDate(date);
  return new Date(`${day}T${time || '00:00:00'}`);
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function timeOf(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`;
}

/** Rounded up to the next 5 minutes, like a "Right now" booking's own start. */
function nextFiveMinutes(value: Date) {
  const rounded = new Date(value);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 5) * 5);
  return rounded;
}

function clock(value: Date) {
  const hours = value.getHours();
  return `${hours % 12 || 12}:${String(value.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}
