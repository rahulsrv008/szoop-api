import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  Coupon,
  CouponCustomer,
  CouponUsage,
  Customer,
} from 'src/database/entities';
import { CouponEligibilityService } from 'src/common/services/coupon-eligibility.service';
import { CustomerCouponsController } from './coupons.controller';
import { CustomerCouponsService } from './coupons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Coupon,
      CouponCustomer,
      CouponUsage,
      Customer,
      Booking,
    ]),
  ],
  controllers: [CustomerCouponsController],
  providers: [CustomerCouponsService, CouponEligibilityService],
  exports: [CustomerCouponsService, CouponEligibilityService],
})
export class CustomerCouponsModule {}
