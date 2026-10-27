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

/**
 * A booking is only confirmed once paid. An unpaid request ('finding') older
 * than this is voided (see DispatchService); money that still arrives for it
 * goes to the customer's wallet.
 */
export const PAYMENT_WINDOW_MINUTES = 15;

/**
 * Online payment attempts an unconfirmed request gets. After this many, the
 * customer either confirms it as pay after service (if eligible) or drops it.
 */
export const MAX_PAYMENT_ATTEMPTS = 3;

/** Pay after service is only offered for bookings up to this total (₹). */
export const PAY_AFTER_SERVICE_MAX_AMOUNT = 200;

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
