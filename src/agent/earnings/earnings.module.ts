import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgentAvailability,
  AgentEarning,
  AgentIncentive,
  Booking,
  BookingStatusHistory,
  BookingVisit,
  Rating,
  SalaryRecord,
} from 'src/database/entities';
import { AgentSharedModule } from '../shared/agent-shared.module';
import { AgentEarningsController } from './earnings.controller';
import { AgentEarningsService } from './earnings.service';
import { AgentIncentivesController } from './incentives.controller';
import { AgentIncentivesService } from './incentives.service';
import { AgentWorkSummaryController } from './work-summary.controller';
import { AgentWorkSummaryService } from './work-summary.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentEarning,
      AgentIncentive,
      Booking,
      BookingStatusHistory,
      BookingVisit,
      AgentAvailability,
      SalaryRecord,
      Rating,
    ]),
    AgentSharedModule,
  ],
  controllers: [AgentEarningsController, AgentIncentivesController, AgentWorkSummaryController],
  providers: [AgentEarningsService, AgentIncentivesService, AgentWorkSummaryService],
})
export class AgentEarningsModule {}
