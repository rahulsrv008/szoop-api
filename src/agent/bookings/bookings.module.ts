import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgentEarning,
  Booking,
  BookingStatusHistory,
  BookingVisit,
  ServicePricing,
  AgentLocation,
  ServiceChecklist,
  ChecklistItem,
  BookingChecklistProgress,
  ChecklistItemProgress,
  BookingServiceExecution,
  BookingSettlement,
  BookingCustomerFeedback,
} from 'src/database/entities';
import { AgentSharedModule } from '../shared/agent-shared.module';
import { AgentSkillsModule } from '../skills/skills.module';
import { AgentBookingsController } from './bookings.controller';
import { AgentBookingsService } from './bookings.service';
import { EnhancedBookingService } from './enhanced-booking.service';
import { ChecklistService } from 'src/common/services/checklist.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingStatusHistory,
      BookingVisit,
      AgentEarning,
      ServicePricing,
      AgentLocation,
      ServiceChecklist,
      ChecklistItem,
      BookingChecklistProgress,
      ChecklistItemProgress,
      BookingServiceExecution,
      BookingSettlement,
      BookingCustomerFeedback,
    ]),
    AgentSharedModule,
    AgentSkillsModule,
  ],
  controllers: [AgentBookingsController],
  providers: [AgentBookingsService, EnhancedBookingService, ChecklistService],
})
export class AgentBookingsModule {}
