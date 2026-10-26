import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentReferral } from 'src/database/entities';
import { AgentSharedModule } from '../shared/agent-shared.module';
import { AgentReferralsController } from './referrals.controller';
import { AgentReferralsService } from './referrals.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgentReferral]), AgentSharedModule],
  controllers: [AgentReferralsController],
  providers: [AgentReferralsService],
})
export class AgentReferralsModule {}
