import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent, AgentMissedJob } from 'src/database/entities';
import { AdminMissedJobsController } from './missed-jobs.controller';
import { AdminMissedJobsService } from './missed-jobs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgentMissedJob, Agent])],
  controllers: [AdminMissedJobsController],
  providers: [AdminMissedJobsService],
})
export class AdminMissedJobsModule {}
