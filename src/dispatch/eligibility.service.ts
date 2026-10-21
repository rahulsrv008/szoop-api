import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AgentAvailability, Booking, BookingVisit } from 'src/database/entities';
import { toDateString, todayString } from 'src/agent/shared/date.util';
import {
  COMMITTED_STATUSES,
  PLAN_FIT_DAYS,
  TRAVEL_BUFFER_MINUTES,
  lateWindowMinutes,
  slotMinutes,
  toMinutes,
} from './dispatch.rules';

type Slot = { bookingId: string; date: string; start: number; end: number };

export const pairKey = (agentId: string, bookingId: string) => `${agentId}:${bookingId}`;

/** Schedule checks shared by the agent's open-job list and the push dispatcher. */
@Injectable()
export class EligibilityService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingVisit)
    private readonly visitRepo: Repository<BookingVisit>,
    @InjectRepository(AgentAvailability)
    private readonly availabilityRepo: Repository<AgentAvailability>,
  ) {}

  /** Jobs this one agent can't take right now (see `conflictPairs`). */
  async blockedJobs(agentId: string, jobs: Booking[]) {
    const pairs = await this.conflictPairs([agentId], jobs);
    return new Set(
      jobs.filter((job) => pairs.has(pairKey(agentId, job.id))).map((job) => job.id),
    );
  }

  /**
   * Agent/job pairs (as `pairKey`) that don't fit: a day the agent marked
   * unavailable, outside the hours they set for that day, or overlapping
   * (plus travel buffer) a job they already hold. Plans are checked visit by visit.
   */
  async conflictPairs(agentIds: string[], jobs: Booking[]) {
    const blocked = new Set<string>();
    if (!agentIds.length || !jobs.length) return blocked;

    const jobSlots = await this.slotsOf(jobs);
    for (const [bookingId, slots] of jobSlots) {
      jobSlots.set(bookingId, firstPlanWeek(slots));
    }
    const dates = [
      ...new Set([...jobSlots.values()].flat().map((slot) => slot.date)),
    ];
    if (!dates.length) return blocked;

    const [days, committed] = await Promise.all([
      this.availabilityRepo.find({
        where: { agentId: In(agentIds), availabilityDate: In(dates) },
      }),
      this.bookingRepo.find({
        where: { agentId: In(agentIds), status: In(COMMITTED_STATUSES) },
      }),
    ]);
    const dayOf = new Map(
      days.map((day) => [
        `${day.agentId}:${String(day.availabilityDate).slice(0, 10)}`,
        day,
      ]),
    );
    const committedSlots = await this.slotsOf(committed, dates);
    const busyOf = new Map<string, Slot[]>();
    for (const booking of committed) {
      const slots = committedSlots.get(booking.id) ?? [];
      busyOf.set(booking.agentId!, [...(busyOf.get(booking.agentId!) ?? []), ...slots]);
    }

    for (const agentId of agentIds) {
      const busy = busyOf.get(agentId) ?? [];
      for (const job of jobs) {
        const clashes = (jobSlots.get(job.id) ?? []).some((slot) => {
          const day = dayOf.get(`${agentId}:${slot.date}`);
          if (day && !day.isAvailable) return true;
          if (day?.startTime && slot.start < toMinutes(day.startTime)) return true;
          if (day?.endTime && slot.end > toMinutes(day.endTime)) return true;
          return busy.some(
            (other) =>
              other.bookingId !== job.id &&
              other.date === slot.date &&
              slot.start < other.end + TRAVEL_BUFFER_MINUTES &&
              other.start < slot.end + TRAVEL_BUFFER_MINUTES,
          );
        });
        if (clashes) blocked.add(pairKey(agentId, job.id));
      }
    }
    return blocked;
  }

  /** The jobs an agent holds on a date, with their slots — for availability changes. */
  async committedSlotsOn(agentId: string, date: string) {
    const held = await this.bookingRepo.find({
      where: { agentId, status: In(COMMITTED_STATUSES) },
    });
    const slots = await this.slotsOf(held, [date]);
    return held
      .map((booking) => ({ booking, slots: slots.get(booking.id) ?? [] }))
      .filter(({ slots: onDate }) => onDate.length > 0);
  }

  /**
   * When each booking is next due (server-local): its earliest not-done visit
   * for plans, else its own start. Slots further in the past than the late
   * window (by default each booking's own, see lateWindowMinutes) don't count,
   * so a booking missing from the map is no longer worth pushing to anyone.
   * Pass null to keep past slots.
   */
  async nextStarts(bookings: Booking[], now = new Date(), lateWindow?: number | null) {
    const slots = await this.slotsOf(bookings);
    const starts = new Map<string, Date>();
    for (const booking of bookings) {
      const window = lateWindow === undefined ? lateWindowMinutes(booking) : lateWindow;
      const cutoff = window === null ? -Infinity : now.getTime() - window * 60_000;
      const upcoming = (slots.get(booking.id) ?? [])
        .map((slot) => {
          const at = new Date(`${slot.date}T00:00:00`);
          at.setMinutes(slot.start);
          return at;
        })
        .filter((at) => at.getTime() > cutoff)
        .sort((a, b) => a.getTime() - b.getTime());
      if (upcoming.length) starts.set(booking.id, upcoming[0]);
    }
    return starts;
  }

  /** Each booking's time slots: its not-yet-done visits for plans, otherwise its own date and time. */
  private async slotsOf(bookings: Booking[], onDates?: string[]) {
    const slots = new Map<string, Slot[]>();
    if (!bookings.length) return slots;

    const visits = await this.visitRepo.find({
      where: {
        bookingId: In(bookings.map((booking) => booking.id)),
        status: Not('done'),
        ...(onDates ? { visitDate: In(onDates) } : {}),
      },
    });
    const visitsOf = new Map<string, BookingVisit[]>();
    for (const visit of visits) {
      visitsOf.set(visit.bookingId, [...(visitsOf.get(visit.bookingId) ?? []), visit]);
    }

    for (const booking of bookings) {
      const length = slotMinutes(booking);
      const planned = visitsOf.get(booking.id);
      const starts = planned?.length
        ? planned.map((visit) => ({ date: visit.visitDate, time: visit.startTime }))
        : [{ date: booking.bookingDate, time: booking.startTime }];
      slots.set(
        booking.id,
        starts
          .map(({ date, time }) => {
            const start = toMinutes(time);
            return {
              bookingId: booking.id,
              date: String(date).slice(0, 10),
              start,
              end: start + length,
            };
          })
          .filter((slot) => !onDates || onDates.includes(slot.date)),
      );
    }
    return slots;
  }
}

/**
 * For a multi-visit plan, only the visits still ahead within PLAN_FIT_DAYS of
 * the first one need to fit (see PLAN_FIT_DAYS). One-off jobs keep their slot.
 */
function firstPlanWeek(slots: Slot[]) {
  if (slots.length <= 1) return slots;
  const today = todayString();
  const ahead = slots
    .filter((slot) => slot.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  if (!ahead.length) return slots;
  const last = new Date(`${ahead[0].date}T00:00:00`);
  last.setDate(last.getDate() + PLAN_FIT_DAYS - 1);
  const cutoff = toDateString(last);
  return ahead.filter((slot) => slot.date <= cutoff);
}
