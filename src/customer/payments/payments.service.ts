import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatusHistory, Payment, PaymentTransaction } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { WalletService } from 'src/common/services/wallet.service';
import { MAX_PAYMENT_ATTEMPTS, PAYMENT_WINDOW_MINUTES } from 'src/common/booking/booking-status';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { RazorpayService } from 'src/integrations/payments/razorpay.service';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { CreateCustomerPaymentDto } from './dto/create-payment.dto';
import { VerifyCustomerPaymentDto } from './dto/verify-payment.dto';
import { isDeployedEnv } from 'src/config/env';

const GATEWAY = 'razorpay';

/** Bookings that can't take a payment any more. */
const CLOSED: Booking['status'][] = ['cancelled', 'expired'];

@Injectable()
export class CustomerPaymentsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepo: Repository<PaymentTransaction>,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationDispatchService,
    private readonly razorpay: RazorpayService,
    private readonly logger: CustomLoggerService,
    private readonly dispatch: DispatchService,
    private readonly wallet: WalletService,
  ) {}

  async createOrder(userId: string, dto: CreateCustomerPaymentDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwnBooking(customerId, dto.bookingId);

    if (CLOSED.includes(booking.status)) {
      throw new BadRequestException('This booking is closed. Please book again.');
    }
    if (booking.bookingMode === 'INSTANT' && booking.status === 'finding' && slotStart(booking) <= Date.now()) {
      throw new BadRequestException('This "Right now" slot has passed. Please book again.');
    }
    if (
      booking.status === 'finding' &&
      Date.now() - booking.createdAt.getTime() > PAYMENT_WINDOW_MINUTES * 60_000
    ) {
      throw new BadRequestException('This booking request has timed out. Please book again.');
    }
    if (
      booking.paymentStatus === 'PAID' ||
      booking.payment?.paymentStatus === 'PAID'
    ) {
      throw new BadRequestException('This booking is already paid');
    }

    const amountPaise = Math.round(Number(booking.totalAmount) * 100);
    if (amountPaise <= 0) {
      throw new BadRequestException('This booking has nothing left to pay');
    }

    const payment = await this.ensurePayment(booking, customerId);
    // An unconfirmed request gets MAX_PAYMENT_ATTEMPTS online tries (one order each).
    if (booking.status === 'finding') {
      const attempts = await this.transactionRepo.count({
        where: { paymentId: payment.id, status: 'created' },
      });
      if (attempts >= MAX_PAYMENT_ATTEMPTS) {
        throw new BadRequestException(
          `Payment failed ${MAX_PAYMENT_ATTEMPTS} times. Confirm it as pay after service if offered, or book again.`,
        );
      }
    }
    if (dto.paymentMethod) {
      payment.paymentMethod = dto.paymentMethod;
      await this.paymentRepo.save(payment);
    }
    const order = await this.razorpay.createOrder(
      amountPaise,
      booking.bookingNumber,
    );

    await this.transactionRepo.save(
      this.transactionRepo.create({
        paymentId: payment.id,
        gatewayName: GATEWAY,
        gatewayTransactionId: order.orderId,
        gatewayResponse: {
          orderId: order.orderId,
          amountPaise: order.amountPaise,
          currency: order.currency,
          mode: order.mode,
        },
        status: 'created',
      }),
    );

    return {
      bookingId: booking.id,
      paymentId: payment.id,
      amountPaise: order.amountPaise,
      currency: order.currency,
      orderId: order.orderId,
      keyId: order.keyId,
      mode: order.mode,
    };
  }

  async verify(userId: string, dto: VerifyCustomerPaymentDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwnBooking(customerId, dto.bookingId);

    const check = this.razorpay.verifyPaymentSignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
    const payment = await this.ensurePayment(booking, customerId);
    const transaction = await this.transactionRepo.findOne({
      where: {
        paymentId: payment.id,
        gatewayName: GATEWAY,
        gatewayTransactionId: dto.razorpayOrderId,
        status: 'created',
      },
    });
    if (!transaction) {
      throw new BadRequestException(
        'Payment order does not belong to this booking',
      );
    }

    const mode = transaction.gatewayResponse?.mode;
    const validStub =
      mode === 'stub' &&
      (check.skipped || this.razorpay.demoPaymentMode) &&
      !isDeployedEnv();
    const validRazorpay = mode === 'razorpay' && check.verified;
    if (!validStub && !validRazorpay) {
      throw new BadRequestException('Payment signature verification failed');
    }

    const captured = await this.capture(booking.id, payment.id, dto.razorpayPaymentId, {
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      verified: check.verified,
      signatureSkipped: check.skipped,
    }, userId, 'Payment captured');

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: captured.booking.status,
      paymentStatus: captured.booking.paymentStatus,
      totalAmount: Number(booking.totalAmount),
      paymentId: payment.id,
      transactionId: dto.razorpayPaymentId,
      paidAt: captured.payment.paidAt,
      refundedToWallet: captured.refundedToWallet,
    };
  }

  /**
   * Razorpay webhook. Public endpoint, so the signature over the raw bytes is
   * the only thing we trust; unknown events are acknowledged and dropped.
   */
  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
    body: Record<string, unknown>,
  ) {
    const check = this.razorpay.verifyWebhookSignature(rawBody, signature);
    if (!check.verified && (!check.skipped || isDeployedEnv())) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = typeof body.event === 'string' ? body.event : null;
    if (event !== 'payment.captured' && event !== 'payment.failed') {
      return { received: true };
    }

    const entity = asRecord(asRecord(asRecord(body.payload)?.payment)?.entity);
    const orderId =
      typeof entity?.order_id === 'string' ? entity.order_id : null;
    if (!orderId) return { received: true };

    const transaction = await this.transactionRepo.findOne({
      where: { gatewayTransactionId: orderId },
      relations: ['payment', 'payment.booking'],
      order: { createdAt: 'ASC' },
    });
    if (!transaction?.payment) {
      this.logger.warn(
        `Webhook ${event} for unknown order ${orderId}`,
        'CustomerPaymentsService',
      );
      return { received: true };
    }

    const payment = transaction.payment;
    const booking = payment.booking ?? null;

    if (event === 'payment.failed') {
      await this.transactionRepo.save(
        this.transactionRepo.create({
          paymentId: payment.id,
          gatewayName: GATEWAY,
          gatewayTransactionId: orderId,
          gatewayResponse: body,
          status: 'failed',
        }),
      );
      // A failure for an earlier attempt can arrive after the payment settled
      // (paid, refunded or voided): never downgrade that.
      if (payment.paymentStatus !== 'PENDING' && payment.paymentStatus !== 'FAILED') {
        return { received: true };
      }
      await this.paymentRepo.update({ id: payment.id }, { paymentStatus: 'FAILED' });
      // Only the payment status: the booking loaded with this webhook may be stale.
      if (booking) await this.bookingRepo.update({ id: booking.id }, { paymentStatus: 'FAILED' });
      return { received: true };
    }

    const gatewayPaymentId =
      typeof entity?.id === 'string' ? entity.id : orderId;
    await this.capture(payment.bookingId, payment.id, gatewayPaymentId, body, null, 'Payment captured (webhook)');
    return { received: true };
  }

  private async findOwnBooking(customerId: string, bookingId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, customerId },
      relations: ['payment'],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Bookings are created with a PENDING payment row; this is the safety net. */
  private async ensurePayment(booking: Booking, customerId: string) {
    if (booking.payment) return booking.payment;
    const payment = await this.paymentRepo.save(
      this.paymentRepo.create({
        bookingId: booking.id,
        customerId,
        amount: Number(booking.totalAmount).toFixed(2),
        paymentStatus: 'PENDING',
      }),
    );
    booking.payment = payment;
    return payment;
  }

  /**
   * Records captured money. The booking is locked first, so a cancel or the
   * unpaid-request timeout can't cross it: an open request becomes a paid
   * (confirmed) booking; a closed one gets the money back in the wallet,
   * unless it was refunded already (the same payment arriving again).
   */
  private async capture(
    bookingId: string,
    paymentId: string,
    gatewayTransactionId: string,
    gatewayResponse: Record<string, unknown>,
    changedBy: string | null,
    remarks: string,
  ) {
    const result = await this.bookingRepo.manager.transaction(async (manager) => {
      const booking = await manager.findOneOrFail(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const payment = await manager.findOneOrFail(Payment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      await manager.save(
        manager.create(PaymentTransaction, {
          paymentId,
          gatewayName: GATEWAY,
          gatewayTransactionId,
          gatewayResponse,
          status: 'captured',
        }),
      );
      payment.paidAt = payment.paidAt ?? new Date();
      payment.paymentMethod = payment.paymentMethod ?? GATEWAY;

      if (CLOSED.includes(booking.status)) {
        if (payment.paymentStatus === 'REFUNDED') {
          return { booking, payment, refundedToWallet: 0, opened: false, dueCleared: 0 };
        }
        const refundedToWallet = await this.wallet.refundBooking(
          booking,
          { amount: payment.amount, paymentStatus: 'PAID' },
          booking.status === 'expired' ? 'BOOKING_EXPIRED' : 'BOOKING_CANCELLED',
          manager,
        );
        payment.paymentStatus = 'REFUNDED';
        booking.paymentStatus = 'REFUNDED';
        await manager.save(payment);
        await manager.update(Booking, { id: bookingId }, { paymentStatus: 'REFUNDED' });
        return { booking, payment, refundedToWallet, opened: false, dueCleared: 0 };
      }

      payment.paymentStatus = 'PAID';
      booking.paymentStatus = 'PAID';
      await manager.save(payment);
      const opened = booking.status === 'finding';
      if (opened) {
        // Older data may already carry an agent from before payment: hand the
        // job straight to them instead of leaving it 'paid' with an agent.
        const next = booking.agentId ? 'accepted' : 'paid';
        await manager.save(manager.create(BookingStatusHistory, { bookingId, status: 'paid', changedBy, remarks }));
        if (next === 'accepted') {
          await manager.save(
            manager.create(BookingStatusHistory, {
              bookingId,
              status: 'accepted',
              changedBy,
              remarks: 'Agent was assigned before payment',
            }),
          );
        }
        booking.status = next;
      }
      await manager.update(Booking, { id: bookingId }, { status: booking.status, paymentStatus: 'PAID' });
      // Paid after the job was completed unpaid: clear what the wallet says they owe.
      const dueCleared =
        booking.status === 'completed' ? await this.wallet.settleDue(bookingId, manager) : 0;
      return { booking, payment, refundedToWallet: 0, opened, dueCleared };
    });

    const { booking } = result;
    const owner = await this.bookingRepo.findOne({ where: { id: bookingId }, relations: ['customer'] });
    const userId = owner?.customer?.userId;
    if (result.opened && booking.status === 'paid') await this.dispatch.kick(bookingId);
    if (userId && result.opened) {
      await this.notifications
        .toUser(userId, {
          app: 'customer',
          title: 'Payment received',
          message: `We received ${Number(booking.totalAmount).toFixed(2)} for booking ${booking.bookingNumber}. We are finding an agent for you.`,
          type: 'payment',
          data: { bookingId, bookingNumber: booking.bookingNumber },
        })
        .catch(() => undefined);
    }
    if (userId && result.dueCleared > 0) {
      await this.notifications
        .toUser(userId, {
          app: 'customer',
          title: 'Payment received',
          message: `Thanks! The ₹${result.dueCleared} due for booking ${booking.bookingNumber} is cleared.`,
          type: 'wallet_due_paid',
          data: { bookingId, bookingNumber: booking.bookingNumber },
        })
        .catch(() => undefined);
    }
    if (userId && result.refundedToWallet > 0) {
      await this.notifications
        .toUser(userId, {
          app: 'customer',
          title: 'Refund added to your wallet',
          message: `Booking ${booking.bookingNumber} was already closed, so the ₹${result.refundedToWallet} you paid has been added to your wallet.`,
          type: 'wallet_refund',
          data: { bookingId, bookingNumber: booking.bookingNumber },
        })
        .catch(() => undefined);
    }
    return result;
  }
}

/** The booking's slot start (server time is India time). */
function slotStart(booking: Booking) {
  return new Date(`${String(booking.bookingDate).slice(0, 10)}T${booking.startTime}`).getTime();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function paymentTransactionId(payment?: Payment | null) {
  return payment?.transactions
    ?.filter(
      (transaction) =>
        transaction.gatewayName === GATEWAY &&
        transaction.status === 'captured' &&
        transaction.gatewayTransactionId,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    ?.gatewayTransactionId ?? null;
}
