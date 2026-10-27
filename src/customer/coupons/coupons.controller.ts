import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CustomerCouponsService } from './coupons.service';
import { ValidateCustomerCouponDto } from './dto/validate-coupon.dto';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.COUPONS)
export class CustomerCouponsController {
  constructor(private readonly couponsService: CustomerCouponsService) {}

  @Get()
  @ApiOperation({
    summary: 'List available coupons for the authenticated customer',
    description:
      'Returns active coupons matching customer eligibility rules that have not yet reached their redemption limit.',
  })
  @ApiQuery({
    name: 'service',
    required: false,
    enum: ['CLEANING', 'COOKING', 'SALON'],
    description: 'Filter coupons eligible for this service',
  })
  list(
    @CurrentUser('sub') userId: string,
    @Query('service') rawService?: string,
  ) {
    const service = rawService
      ? (rawService.toUpperCase().trim() as 'CLEANING' | 'COOKING' | 'SALON')
      : undefined;
    return this.couponsService.listAvailable(userId, service);
  }

  @Post('validate')
  @ApiOperation({
    summary: 'Validate a coupon code and calculate discount on subtotal',
  })
  validate(
    @CurrentUser('sub') userId: string,
    @Body() dto: ValidateCustomerCouponDto,
  ) {
    return this.couponsService.validate(
      userId,
      dto.code,
      dto.subtotal,
      dto.service,
    );
  }
}
