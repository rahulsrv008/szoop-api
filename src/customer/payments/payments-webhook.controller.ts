import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ROUTES } from 'src/app.routes';
import { CustomerPaymentsService } from './payments.service';
import { NoRateLimit } from 'src/common/rate-limit/rate-limit.decorator';

/**
 * Public gateway callback — no auth decorator. The payload is arbitrary JSON,
 * so it is taken untyped and every property access is guarded in the service.
 */
@ApiTags('customer')
@NoRateLimit()
@Controller(ROUTES.WEBHOOKS.PAYMENTS)
export class CustomerPaymentsWebhookController {
  constructor(private readonly paymentsService: CustomerPaymentsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Razorpay payment webhook (public, signature verified)',
  })
  handle(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    // main.ts keeps the exact bytes; the signature is computed over them.
    const rawBody =
      (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(body);
    return this.paymentsService.handleWebhook(rawBody, signature, body);
  }
}
