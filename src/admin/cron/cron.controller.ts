import {
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
  Headers,
  Logger,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { BookingExpiryService } from 'src/common/booking/booking-expiry.service';
import { ROUTES } from 'src/app.routes';

/**
 * Cron endpoints called by Vercel Cron (or any scheduler).
 *
 * Protected by a shared secret: set CRON_SECRET in env and the caller must
 * send `Authorization: Bearer <CRON_SECRET>`.  When CRON_SECRET is not set
 * the endpoint is disabled entirely (returns 401) so it cannot run in local
 * development by accident.
 */
@ApiExcludeController()
@Controller(ROUTES.ADMIN.CRON)
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(private readonly expiry: BookingExpiryService) {}

  @Post('expire-bookings')
  @HttpCode(200)
  async expireBookings(@Headers('authorization') auth: string) {
    this.requireCronSecret(auth);
    const result = await this.expiry.expireStale();
    this.logger.log(
      `Cron: expired ${result.expired} stale booking(s)`,
    );
    return result;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private requireCronSecret(auth: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new UnauthorizedException(
        'CRON_SECRET is not configured – cron endpoint disabled',
      );
    }
    if (auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }
}
