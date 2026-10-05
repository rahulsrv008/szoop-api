import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  BookingItem,
  BookingVisit,
  Coupon,
  CouponUsage,
  CustomerAddress,
  HomeCategory,
  HomeCategoryOption,
  Payment,
  Rating,
  SupportTicket,
  Service,
  ServiceArea,
  ServicePricing,
} from 'src/database/entities';
import { CustomerBookingsController } from './bookings.controller';
import { CustomerBookingsService } from './bookings.service';
import { DispatchModule } from 'src/dispatch/dispatch.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingItem,
      BookingVisit,
      CustomerAddress,
      Service,
      ServicePricing,
      ServiceArea,
      Payment,
      Coupon,
      CouponUsage,
      Rating,
      SupportTicket,
      HomeCategory,
      HomeCategoryOption,
    ]),
    DispatchModule,
  ],
  controllers: [CustomerBookingsController],
  providers: [CustomerBookingsService],
})
export class CustomerBookingsModule {}
