import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AgentAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';
import { AgentReferralsService } from './referrals.service';

@ApiTags('agent')
@AgentAuth()
@Controller(ROUTES.AGENT.REFERRALS)
export class AgentReferralsController {
  constructor(private readonly referralsService: AgentReferralsService) {}

  @Get()
  @ApiOperation({
    summary: 'Refer & Earn: own referral code, invites used and people invited',
  })
  overview(@CurrentUser('sub') userId: string) {
    return this.referralsService.overview(userId);
  }

  @Get('validate/:code')
  @RateLimit(RATE_LIMITS.REFERRAL_VALIDATE)
  @ApiOperation({
    summary: 'Check a referral code on the signup form (does not use it up)',
  })
  validate(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.referralsService.validate(userId, code);
  }
}
