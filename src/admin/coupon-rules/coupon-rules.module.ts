import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon, CouponEligibilityRule } from 'src/database/entities';
import { AdminCouponRulesController } from './coupon-rules.controller';
import { AdminCouponRulesService } from './coupon-rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([CouponEligibilityRule, Coupon])],
  controllers: [AdminCouponRulesController],
  providers: [AdminCouponRulesService],
  exports: [AdminCouponRulesService],
})
export class AdminCouponRulesModule {}
