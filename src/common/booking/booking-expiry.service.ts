import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, In, Repository } from 'typeorm';
import { Booking, BookingStatus, Payment } from 'src/database/entities';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';

/**
 * Expires bookings that are still in a pre-assignment status but whose
 * scheduled slot has already passed.
 *
 * Expirable statuses: 'paid' (payment collected, no agent found) and
 * 'finding' (payment not collected, booking never confirmed).
 *
 * The grace window (default 30 min) gives agents a buffer after the
 * slot start to pick up / mark bookings before the system steps in.
 * Override via env BOOKING_EXPIRY_GRACE_MINUTES.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  private get graceMinutes(): number {
    const env = parseInt(process.env.BOOKING_EXPIRY_GRACE_MINUTES ?? '', 10);
    return Number.isFinite(env) && env >= 0 ? env : 30;
  }

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly history: BookingHistoryService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  /**
   * Main entry point: called by the cron controller on a schedule.
   * Returns a summary of what was expired.
   */
  async expireStale(): Promise<{ expired: number; ids: string[] }> {
    const cutoff = new Date(Date.now() - this.graceMinutes * 60_000);
    // bookingDate is a DATE column (e.g. "2026-10-25") and startTime is a TIME
    // column (e.g. "09:00"). We combine them in Postgres and compare to the cutoff.
    const stale: Booking[] = await this.bookingRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.customer', 'customer')
      .leftJoinAndSelect('b.payment', 'payment')
      .where('b.status IN (:...statuses)', {
        statuses: ['paid', 'finding'] satisfies BookingStatus[],
      })
      .andWhere(
        "(b.booking_date + b.start_time)::timestamptz AT TIME ZONE 'Asia/Kolkata' < :cutoff",
        { cutoff },
      )
      .getMany();

    if (!stale.length) return { expired: 0, ids: [] };

    const expired: string[] = [];

    for (const booking of stale) {
      try {
        await this.expireOne(booking);
        expired.push(booking.id);
      } catch (err) {
        this.logger.error(
          `Failed to expire booking ${booking.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Expired ${expired.length} stale bookings`);
    return { expired: expired.length, ids: expired };
  }

  private async expireOne(booking: Booking): Promise<void> {
    // 'paid' had a collected payment → mark REFUNDED so ops can process it.
    // 'finding' had no payment yet → just void it.
    const nextPaymentStatus =
      booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'VOIDED';

    booking.status = 'expired';
    booking.paymentStatus = nextPaymentStatus;
    await this.bookingRepo.save(booking);

    if (booking.payment) {
      booking.payment.paymentStatus = nextPaymentStatus;
      await this.paymentRepo.save(booking.payment);
    }

    await this.history.record(
      booking.id,
      'expired',
      null,
      'No agent was assigned before the scheduled slot. Auto-expired by system.',
    );

    // Notify the customer so they know to book again.
    const userId = booking.customer?.userId;
    if (userId) {
      await this.notifications.toUser(userId, {
        title: 'No expert found',
        message: `We couldn't find an expert for booking #${booking.bookingNumber}. ${
          nextPaymentStatus === 'REFUNDED'
            ? 'Your payment will be refunded shortly. '
            : ''
        }Please try booking again.`,
        type: 'booking',
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      });
    }
  }
}
