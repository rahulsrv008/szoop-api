import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from 'src/database/entities';

/**
 * finding → paid → accepted → arriving → ongoing → completed
 * cancelled is reachable any time before the service starts.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  finding: ['paid', 'cancelled'],
  paid: ['accepted', 'cancelled'],
  accepted: ['arriving', 'ongoing', 'cancelled'],
  arriving: ['ongoing', 'cancelled'],
  ongoing: ['completed'],
  completed: [],
  cancelled: [],
};

/** Statuses where the booking date/time can still be moved. */
export const RESCHEDULABLE: BookingStatus[] = [
  'finding',
  'paid',
  'accepted',
  'arriving',
];

/**
 * Statuses an admin can assign a first agent in. Only after payment: an agent
 * on an unpaid ('finding') booking would leave it 'paid' with an agent after
 * payment, a state the agent can't move forward from. Swapping an existing
 * agent goes through reassign.
 */
export const ASSIGNABLE: BookingStatus[] = ['paid'];

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
