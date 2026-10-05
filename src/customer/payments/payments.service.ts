import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, Payment, PaymentTransaction } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { RazorpayService } from 'src/integrations/payments/razorpay.service';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { CreateCustomerPaymentDto } from './dto/create-payment.dto';
import { VerifyCustomerPaymentDto } from './dto/verify-payment.dto';

const GATEWAY = 'razorpay';

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
    private readonly history: BookingHistoryService,
    private readonly notifications: NotificationDispatchService,
    private readonly razorpay: RazorpayService,
    private readonly logger: CustomLoggerService,
    private readonly dispatch: DispatchService,
  ) {}

  async createOrder(userId: string, dto: CreateCustomerPaymentDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwnBooking(customerId, dto.bookingId);

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
    if (dto.paymentMethod) {
      payment.paymentMethod = dto.paymentMethod;
      await this.paymentRepo.save(payment);
    }
    const order = this.razorpay.createOrder(amountPaise, booking.bookingNumber);

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
    if (!check.verified && !check.skipped) {
      throw new BadRequestException('Payment signature verification failed');
    }

    const payment = await this.ensurePayment(booking, customerId);
    await this.markPaid(payment, dto.razorpayPaymentId, {
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      verified: check.verified,
      signatureSkipped: check.skipped,
    });
    await this.settleBooking(booking, userId, 'Payment captured');

    await this.notifications.toUser(userId, {
      title: 'Payment received',
      message: `We received ${Number(booking.totalAmount).toFixed(2)} for booking ${booking.bookingNumber}. We are finding an agent for you.`,
      type: 'payment',
      data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
    });

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      totalAmount: Number(booking.totalAmount),
      paymentId: payment.id,
      paidAt: payment.paidAt,
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
    if (!check.verified && !check.skipped) {
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
      payment.paymentStatus = 'FAILED';
      await this.paymentRepo.save(payment);
      await this.transactionRepo.save(
        this.transactionRepo.create({
          paymentId: payment.id,
          gatewayName: GATEWAY,
          gatewayTransactionId: orderId,
          gatewayResponse: body,
          status: 'failed',
        }),
      );
      if (booking) {
        booking.paymentStatus = 'FAILED';
        await this.bookingRepo.save(booking);
      }
      return { received: true };
    }

    const gatewayPaymentId =
      typeof entity?.id === 'string' ? entity.id : orderId;
    await this.markPaid(payment, gatewayPaymentId, body);
    if (booking) {
      await this.settleBooking(booking, null, 'Payment captured (webhook)');
    }
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

  private async markPaid(
    payment: Payment,
    gatewayTransactionId: string,
    gatewayResponse: Record<string, unknown>,
  ) {
    payment.paymentStatus = 'PAID';
    payment.paidAt = payment.paidAt ?? new Date();
    payment.paymentMethod = payment.paymentMethod ?? GATEWAY;
    await this.paymentRepo.save(payment);

    await this.transactionRepo.save(
      this.transactionRepo.create({
        paymentId: payment.id,
        gatewayName: GATEWAY,
        gatewayTransactionId,
        gatewayResponse,
        status: 'captured',
      }),
    );
  }

  /** Mirrors the payment onto the booking and moves finding → paid once. */
  private async settleBooking(
    booking: Booking,
    changedBy: string | null,
    remarks: string,
  ) {
    booking.paymentStatus = 'PAID';
    if (booking.status === 'finding') {
      await this.history.transition(booking, 'paid', changedBy, remarks);
      // Older data may already carry an agent from before payment: hand the
      // job straight to them instead of leaving it 'paid' with an agent.
      if (booking.agentId) {
        await this.history.transition(booking, 'accepted', changedBy, 'Agent was assigned before payment');
        return;
      }
      await this.dispatch.kick(booking.id);
      return;
    }
    await this.bookingRepo.save(booking);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
