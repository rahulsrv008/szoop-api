import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { isDeployedEnv } from 'src/config/env';

export interface GatewayOrder {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  /** `razorpay` once keys are present, `stub` for local development. */
  mode: 'razorpay' | 'stub';
}

/** Values written to `payments.payment_method` after a real checkout. */
export type StoredPaymentMethod =
  | 'UPI'
  | 'CARD'
  | 'NETBANKING'
  | 'WALLET'
  | 'RAZORPAY';

/** Razorpay `payment.method` → the codes the admin panel and customer app share. */
export function mapRazorpayMethod(method?: string | null): StoredPaymentMethod {
  switch ((method ?? '').toLowerCase()) {
    case 'upi':
      return 'UPI';
    case 'card':
    case 'emi':
    case 'cardless_emi':
      return 'CARD';
    case 'netbanking':
      return 'NETBANKING';
    case 'wallet':
    case 'paylater':
      return 'WALLET';
    default:
      return 'RAZORPAY';
  }
}

@Injectable()
export class RazorpayService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  get keyId() {
    return this.config.get<string>('RAZORPAY_KEY_ID')?.trim() || null;
  }

  private get keySecret() {
    return this.config.get<string>('RAZORPAY_KEY_SECRET')?.trim() || null;
  }

  get demoPaymentMode() {
    return (
      (this.config.get<string>('DEMO_PAYMENT_MODE') ?? 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  async createOrder(
    amountPaise: number,
    receipt: string,
  ): Promise<GatewayOrder> {
    const keyId = this.keyId;
    const secret = this.keySecret;
    if (!isDeployedEnv() && (this.demoPaymentMode || (!keyId && !secret))) {
      this.logger.warn(
        this.demoPaymentMode
          ? 'Demo payment mode enabled — issuing a stub order id'
          : 'RAZORPAY_KEY_ID missing — issuing a stub order id',
        'RazorpayService',
      );
      return {
        orderId: `stub_order_${receipt}`,
        amountPaise,
        currency: 'INR',
        keyId: null,
        mode: 'stub',
      };
    }

    if (!keyId || !secret) {
      this.logger.error(
        'Razorpay API credentials are incomplete',
        undefined,
        'RazorpayService',
      );
      throw new ServiceUnavailableException(
        'Online payments are not configured',
      );
    }

    try {
      const client = this.client(keyId, secret);
      const order = await client.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt.slice(0, 40),
      });
      if (
        !order?.id ||
        Number(order.amount) !== amountPaise ||
        order.currency !== 'INR'
      ) {
        throw new ServiceUnavailableException('Could not start online payment');
      }
      return {
        orderId: order.id,
        amountPaise,
        currency: 'INR',
        keyId,
        mode: 'razorpay',
      };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      this.logger.error(
        `Razorpay order request failed${status ? ` (HTTP ${status})` : ''}`,
        error instanceof Error ? error.stack : undefined,
        'RazorpayService',
      );
      if (status === 401) {
        throw new UnauthorizedException(
          'Razorpay rejected KEY_ID / KEY_SECRET. Use a matching pair from the same Test or Live mode, then restart the backend.',
        );
      }
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Could not start online payment');
    }
  }

  /** Instrument used on a captured Razorpay payment, or null when we cannot ask. */
  async fetchPaymentMethod(paymentId: string): Promise<StoredPaymentMethod | null> {
    if (!paymentId || paymentId.startsWith('stub_')) return null;
    const keyId = this.keyId;
    const secret = this.keySecret;
    if (!keyId || !secret) return null;
    try {
      const payment = await this.client(keyId, secret).payments.fetch(paymentId);
      const method = typeof payment?.method === 'string' ? payment.method : null;
      return method ? mapRazorpayMethod(method) : null;
    } catch (error) {
      this.logger.warn(
        `Could not fetch Razorpay payment ${paymentId}`,
        'RazorpayService',
      );
      if (error instanceof Error && error.stack) {
        this.logger.warn(error.stack, 'RazorpayService');
      }
      return null;
    }
  }

  /** Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret). */
  verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature?: string,
  ) {
    const secret = this.keySecret;
    if (!secret) return { verified: false, skipped: true };
    if (!signature) return { verified: false, skipped: false };

    const expected = createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return { verified: this.safeEqual(expected, signature), skipped: false };
  }

  /** Webhook signature: HMAC_SHA256(rawBody, webhook_secret). */
  verifyWebhookSignature(rawBody: string, signature?: string) {
    const secret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return { verified: false, skipped: true };
    if (!signature) return { verified: false, skipped: false };

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return { verified: this.safeEqual(expected, signature), skipped: false };
  }

  private client(keyId: string, secret: string) {
    return new Razorpay({ key_id: keyId, key_secret: secret });
  }

  private safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
