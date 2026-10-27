import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  Agent,
  AgentAttendance,
  AgentAvailability,
  AgentDocument,
  Booking,
  Customer,
  Payment,
  Rating,
  ServiceArea,
  SupportTicket,
} from 'src/database/entities';
import { AdminDashboardController } from './dashboard.controller';
import { AdminDashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Admin,
      Customer,
      Agent,
      AgentDocument,
      AgentAttendance,
      AgentAvailability,
      Booking,
      Payment,
      Rating,
      ServiceArea,
      SupportTicket,
    ]),
  ],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
