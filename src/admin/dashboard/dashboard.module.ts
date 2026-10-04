import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  Agent,
  AgentAttendance,
  AgentDocument,
  Booking,
  Customer,
  Payment,
  Rating,
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
      Booking,
      Payment,
      Rating,
      SupportTicket,
    ]),
  ],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
