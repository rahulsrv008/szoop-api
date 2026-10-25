import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';
import { CustomerProfileService } from './profile.service';
import { UpdateCustomerProfileDto } from './dto/update-profile.dto';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.PROFILE)
export class CustomerProfileController {
  constructor(private readonly profileService: CustomerProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get customer profile' })
  get(@CurrentUser('sub') userId: string) {
    return this.profileService.get(userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update customer profile' })
  update(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.profileService.update(userId, dto);
  }

  @Delete()
  @RateLimit(RATE_LIMITS.ACCOUNT_DELETE)
  @ApiOperation({
    summary: 'Request account deletion: block the customer and open an admin ticket',
  })
  remove(@CurrentUser('sub') userId: string) {
    return this.profileService.deleteAccount(userId);
  }
}
