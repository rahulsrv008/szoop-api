import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  Booking,
  BookingStatusHistory,
  Coupon,
  CouponUsage,
  Payment,
  PaymentStatus,
  WalletTransactionReason,
} from 'src/database/entities';
import { WalletService } from 'src/common/services/wallet.service';
import { assertTransition } from './booking-status';

export type ClosedBooking = {
  booking: Booking;
  paymentStatus: PaymentStatus;
  refundedToWallet: number;
  /** Codes of coupons this booking had used, now free to use again. */
  releasedCoupons: string[];
};

/** " Your coupon X can be used again." for the coupons a closed booking gave back. */
export function couponNote(codes: string[]) {
  if (!codes.length) return '';
  return codes.length === 1
    ? ` Your coupon ${codes[0]} can be used again.`
    : ` Your coupons ${codes.join(', ')} can be used again.`;
}

/**
 * Cancels or expires a booking and settles its payment in one transaction:
 * a collected payment becomes REFUNDED and is credited to the customer's
 * wallet; with no collected payment (unpaid, or free) it becomes VOIDED. A
 * coupon on it is given back: it only counts as used once the customer got
 * the service. The booking row is locked first, so a concurrent accept,
 * cancel or expiry waits and then sees the new status.
 */
@Injectable()
export class BookingClosureService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Returns null when `onlyIf` rejects the booking as it is once locked;
   * otherwise throws if the status can't move to `next`.
   */
  close(
    bookingId: string,
    next: 'cancelled' | 'expired',
    options: {
      reason: WalletTransactionReason;
      changedBy?: string | null;
      remarks?: string | null;
      onlyIf?: (booking: Booking) => boolean;
    },
  ): Promise<ClosedBooking | null> {
    return this.bookingRepo.manager.transaction(async (manager) => {
      // No relations here: FOR UPDATE can't lock the nullable side of a join.
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) return null;
      if (options.onlyIf && !options.onlyIf(booking)) return null;
      assertTransition(booking.status, next);

      const payment = await manager.findOne(Payment, {
        where: { bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      // The payment row is what was collected; with none, nothing was taken.
      const paymentStatus: PaymentStatus = payment?.paymentStatus === 'PAID' ? 'REFUNDED' : 'VOIDED';
      const refundedToWallet = await this.wallet.refundBooking(
        booking,
        payment,
        options.reason,
        manager,
      );

      if (payment) await manager.update(Payment, { id: payment.id }, { paymentStatus });
      await manager.update(Booking, { id: bookingId }, { status: next, paymentStatus });
      await manager.save(
        manager.create(BookingStatusHistory, {
          bookingId,
          status: next,
          changedBy: options.changedBy ?? null,
          remarks: options.remarks ?? null,
        }),
      );

      const releasedCoupons = await this.releaseCoupons(manager, bookingId);

      booking.status = next;
      booking.paymentStatus = paymentStatus;
      return { booking, paymentStatus, refundedToWallet, releasedCoupons };
    });
  }

  private async releaseCoupons(manager: EntityManager, bookingId: string) {
    const usages = await manager.find(CouponUsage, {
      where: { bookingId },
      relations: ['coupon'],
    });
    for (const usage of usages) {
      await manager.delete(CouponUsage, { id: usage.id });
      await manager
        .createQueryBuilder()
        .update(Coupon)
        .set({ usedCount: () => 'GREATEST(used_count - 1, 0)' })
        .where('id = :id', { id: usage.couponId })
        .execute();
    }
    return usages.map((usage) => usage.coupon.code);
  }
}
