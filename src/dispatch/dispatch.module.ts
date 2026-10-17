import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Agent,
  AgentAvailability,
  AgentLocation,
  AgentMissedJob,
  Booking,
  BookingDispatch,
  BookingOffer,
  BookingStatusHistory,
  BookingVisit,
  SupportTicket,
} from 'src/database/entities';
import { AgentSkillsModule } from 'src/agent/skills/skills.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { EligibilityService } from './eligibility.service';
import { HeldJobsService } from './held-jobs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Agent,
      AgentAvailability,
      AgentLocation,
      AgentMissedJob,
      Booking,
      BookingDispatch,
      BookingOffer,
      BookingStatusHistory,
      BookingVisit,
      SupportTicket,
    ]),
    AgentSkillsModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService, EligibilityService, HeldJobsService],
  exports: [DispatchService, EligibilityService],
})
export class DispatchModule {}
