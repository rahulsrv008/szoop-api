import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { IdentityService } from 'src/common/auth/identity.service';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ServiceabilityService } from 'src/common/services/serviceability.service';
import { CheckServiceabilityDto } from './dto/check-serviceability.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('customer')
@Controller(ROUTES.CUSTOMER.SERVICEABILITY)
export class CustomerServiceabilityController {
  constructor(
    private readonly serviceability: ServiceabilityService,
    private readonly identity: IdentityService,
  ) {}

  /** Public: the app checks the location during sign-up, before a token exists. */
  @Get()
  @ApiOperation({
    summary: 'Is this location served? If not, a "coming soon to Taj City" message',
  })
  check(@Query() query: CheckServiceabilityDto) {
    return this.serviceability.check(query);
  }

  @RateLimit(RATE_LIMITS.CITY_WAITLIST)
  @Post('notify')
  @HttpCode(200)
  @CustomerAuth()
  @ApiOperation({ summary: 'Notify me when you launch in my city' })
  async notify(
    @CurrentUser('sub') userId: string,
    @Body() dto: CheckServiceabilityDto,
  ) {
    const customerId = await this.identity.requireCustomerId(userId);
    return this.serviceability.joinWaitlist(customerId, dto);
  }
}
