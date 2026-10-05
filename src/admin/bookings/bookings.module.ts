import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent, AgentLocation, Booking, Payment } from 'src/database/entities';
import { AdminBookingsController } from './bookings.controller';
import { AdminBookingsService } from './bookings.service';
import { DispatchModule } from 'src/dispatch/dispatch.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Agent, Payment, AgentLocation]),
    DispatchModule,
  ],
  controllers: [AdminBookingsController],
  providers: [AdminBookingsService],
})
export class AdminBookingsModule {}
