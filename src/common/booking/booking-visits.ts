import { randomInt } from 'crypto';
import { Booking } from 'src/database/entities';
import { BookingVisitShift } from 'src/database/entities/booking-visit';

export interface VisitDraft {
  visitDate: string;
  shift: BookingVisitShift;
  startTime: string;
}

/** One row per booked date, split into morning and evening when both are selected. */
export function buildVisitPlan(booking: Pick<Booking, 'bookingDate' | 'startTime' | 'planType' | 'planTitle' | 'notes'>): VisitDraft[] {
  const days = serviceDayCount(booking.planType, booking.planTitle, booking.notes);
  const slots = shiftSlots(booking.planTitle, booking.notes, booking.startTime);
  const start = booking.bookingDate.slice(0, 10);
  const visits: VisitDraft[] = [];
  for (let day = 0; day < days; day += 1) {
    const visitDate = addDateString(start, day);
    for (const slot of slots) {
      visits.push({ visitDate, shift: slot.shift, startTime: slot.startTime });
    }
  }
  return visits;
}

export function freshOtp() {
  return String(randomInt(1000, 10000));
}

function serviceDayCount(planType: string | null, planTitle: string | null, notes: string | null) {
  const fromNotes = notes?.match(/Service runs for (\d+) days/i);
  if (fromNotes) return clampDays(Number(fromNotes[1]));
  const title = planTitle ?? '';
  if (/trial pack/i.test(title)) return 3;
  if (/28 days/i.test(title)) return 30;
  const numbered = title.match(/(\d+)\s*days/i);
  if (numbered) return clampDays(Number(numbered[1]));
  if (planType === 'MONTHLY') return 30;
  return 1;
}

function clampDays(days: number) {
  if (!Number.isFinite(days) || days < 1) return 1;
  return Math.min(Math.round(days), 31);
}

function shiftSlots(planTitle: string | null, notes: string | null, startTime: string) {
  const title = planTitle ?? '';
  const both = /\bboth\b/i.test(title);
  const evening = /evening/i.test(title);
  const morning = /morning/i.test(title);
  const primary = toTimeString(startTime);
  if (both) {
    return [
      { shift: 'morning' as const, startTime: primary },
      { shift: 'evening' as const, startTime: eveningTime(notes) },
    ];
  }
  if (evening) return [{ shift: 'evening' as const, startTime: primary }];
  if (morning) return [{ shift: 'morning' as const, startTime: primary }];
  return [{ shift: 'visit' as const, startTime: primary }];
}

function eveningTime(notes: string | null) {
  const match = notes?.match(/Evening slot:.*?\((\d{2}:\d{2})\)/i);
  return toTimeString(match?.[1] ?? '16:45');
}

function toTimeString(value: string) {
  const clock = value.slice(0, 5);
  return clock.length === 5 ? `${clock}:00` : value;
}

function addDateString(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, (day || 1) + days);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
