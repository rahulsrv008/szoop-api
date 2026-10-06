import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { DispatchService } from './dispatch.service';
import { NoRateLimit } from 'src/common/rate-limit/rate-limit.decorator';

/**
 * Cron entry point for hosts that can't keep a timer alive (Vercel).
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set;
 * without it configured the route doesn't exist.
 */
@ApiExcludeController()
@NoRateLimit()
@Controller(ROUTES.INTERNAL.DISPATCH)
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('tick')
  tick(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new NotFoundException();
    if (authorization !== `Bearer ${secret}`) throw new UnauthorizedException();
    return this.dispatch.tick();
  }
}
