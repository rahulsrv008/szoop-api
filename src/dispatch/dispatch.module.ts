import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Agent,
  AgentAvailability,
  Booking,
  BookingDispatch,
  BookingOffer,
  BookingVisit,
} from 'src/database/entities';
import { AgentSkillsModule } from 'src/agent/skills/skills.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { EligibilityService } from './eligibility.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Agent,
      AgentAvailability,
      Booking,
      BookingDispatch,
      BookingOffer,
      BookingVisit,
    ]),
    AgentSkillsModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService, EligibilityService],
  exports: [DispatchService, EligibilityService],
})
export class DispatchModule {}
