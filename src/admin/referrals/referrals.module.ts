import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  Agent,
  AgentReferral,
  AgentReferralReward,
  SystemSetting,
} from 'src/database/entities';
import { AdminReferralsController } from './referrals.controller';
import { AdminReferralsService } from './referrals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Admin,
      Agent,
      AgentReferral,
      AgentReferralReward,
      SystemSetting,
    ]),
  ],
  controllers: [AdminReferralsController],
  providers: [AdminReferralsService],
})
export class AdminReferralsModule {}
