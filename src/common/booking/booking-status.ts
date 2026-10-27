import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from 'src/database/entities';

/**
 * finding → paid → accepted → arriving → ongoing → completed
 * cancelled is reachable any time before the service starts.
 * expired is set by the system when no agent was assigned before the slot passed.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  finding: ['paid', 'cancelled', 'expired'],
  paid: ['accepted', 'cancelled', 'expired'],
  accepted: ['arriving', 'ongoing', 'cancelled'],
  arriving: ['ongoing', 'cancelled'],
  ongoing: ['completed'],
  completed: [],
  cancelled: [],
  expired: [],
};

/** Statuses where the booking date/time can still be moved. */
export const RESCHEDULABLE: BookingStatus[] = [
  'finding',
  'paid',
  'accepted',
  'arriving',
];

/** Statuses an agent can still be (re)assigned in. */
export const ASSIGNABLE: BookingStatus[] = ['finding', 'paid', 'accepted'];

export const ACTIVE_STATUSES: BookingStatus[] = [
  'paid',
  'accepted',
  'arriving',
  'ongoing',
];

export function canTransition(from: BookingStatus, to: BookingStatus) {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!canTransition(from, to)) {
    throw new BadRequestException(
      `Booking cannot move from ${from} to ${to}`,
    );
  }
}
