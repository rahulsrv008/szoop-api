import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent, AgentAvailability, Booking, BookingDispatch } from 'src/database/entities';
import { DispatchModule } from 'src/dispatch/dispatch.module';
import { AdminBookingMonitorController } from './booking-monitor.controller';
import { AdminBookingMonitorService } from './booking-monitor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Agent, AgentAvailability, BookingDispatch]),
    DispatchModule,
  ],
  controllers: [AdminBookingMonitorController],
  providers: [AdminBookingMonitorService],
})
export class AdminBookingMonitorModule {}
