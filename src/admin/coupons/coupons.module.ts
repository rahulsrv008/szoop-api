import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon, CouponCustomer, CouponUsage } from 'src/database/entities';
import { AdminCouponsController } from './coupons.controller';
import { AdminCouponsService } from './coupons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, CouponCustomer, CouponUsage])],
  controllers: [AdminCouponsController],
  providers: [AdminCouponsService],
})
export class AdminCouponsModule {}
