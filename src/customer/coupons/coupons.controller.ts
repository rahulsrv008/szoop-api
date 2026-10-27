import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ROUTES } from 'src/app.routes';
import { TokenService } from 'src/common/auth/token.service';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CustomerCouponsService } from './coupons.service';
import { ValidateCustomerCouponDto } from './dto/validate-coupon.dto';

@ApiTags('customer')
@Controller(ROUTES.CUSTOMER.COUPONS)
export class CustomerCouponsController {
  constructor(
    private readonly couponsService: CustomerCouponsService,
    private readonly tokens: TokenService,
  ) { }

  @Get()
  @ApiOperation({
    summary: 'List available coupons for customer or guests',
    description:
      'Returns active coupons matching customer eligibility rules that have not yet reached their redemption limit.',
  })
  @ApiQuery({
    name: 'service',
    required: false,
    enum: ['CLEANING', 'COOKING', 'SALON'],
    description: 'Filter coupons eligible for this service',
  })
  async list(
    @Req() req: Request,
    @Query('service') rawService?: string,
  ) {
    let userId: string | undefined;
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const user = this.tokens.verifyAccessToken(token);
        if (user && user.role === 'customer') {
          userId = user.sub;
        }
      } catch {
        // Guest mode fallback
      }
    }

    const service = rawService
      ? (rawService.toUpperCase().trim() as 'CLEANING' | 'COOKING' | 'SALON')
      : undefined;
    return this.couponsService.listAvailable(userId, service);
  }

  @Post('validate')
  @CustomerAuth()
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
