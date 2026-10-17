import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentLocation, Booking, BookingStatusHistory, BookingVisit } from 'src/database/entities';
import { CustomerTrackingController } from './tracking.controller';
import { CustomerTrackingService } from './tracking.service';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, AgentLocation, BookingStatusHistory, BookingVisit])],
  controllers: [CustomerTrackingController],
  providers: [CustomerTrackingService],
})
export class CustomerTrackingModule {}
