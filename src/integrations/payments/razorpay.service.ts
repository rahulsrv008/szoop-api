import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
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

@Injectable()
export class RazorpayService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  get keyId() {
    return this.config.get<string>('RAZORPAY_KEY_ID') || null;
  }

  async createOrder(
    amountPaise: number,
    receipt: string,
  ): Promise<GatewayOrder> {
    const keyId = this.keyId;
    const secret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keyId && !secret && !isDeployedEnv()) {
      this.logger.warn(
        'RAZORPAY_KEY_ID missing — issuing a stub order id',
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

    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: receipt.slice(0, 40),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(
        'Razorpay order request failed',
        error instanceof Error ? error.stack : undefined,
        'RazorpayService',
      );
      throw new ServiceUnavailableException('Could not start online payment');
    }

    if (!response.ok) {
      this.logger.error(
        `Razorpay order request returned HTTP ${response.status}`,
        undefined,
        'RazorpayService',
      );
      throw new ServiceUnavailableException('Could not start online payment');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.error(
        'Razorpay returned invalid order JSON',
        error instanceof Error ? error.stack : undefined,
        'RazorpayService',
      );
      throw new ServiceUnavailableException('Could not start online payment');
    }
    const order =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : null;
    if (
      !order ||
      typeof order.id !== 'string' ||
      order.amount !== amountPaise ||
      order.currency !== 'INR'
    ) {
      this.logger.error(
        'Razorpay returned an invalid order response',
        undefined,
        'RazorpayService',
      );
      throw new ServiceUnavailableException('Could not start online payment');
    }

    return {
      orderId: order.id,
      amountPaise,
      currency: 'INR',
      keyId,
      mode: 'razorpay',
    };
  }

  /** Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret). */
  verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature?: string,
  ) {
    const secret = this.config.get<string>('RAZORPAY_KEY_SECRET');
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

  private safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
