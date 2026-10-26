import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentReferral, AgentReferralStatus } from 'src/database/entities';
import { ReferralService } from 'src/common/referrals/referral.service';
import { ReferralRewardsService, RewardView, jobsDoneSql } from 'src/common/referrals/referral-rewards.service';
import { ReasonDetail, reasonText } from 'src/common/referrals/referral-reasons';
import { formatEmployeeId } from 'src/common/referrals/employee-id';
import { AgentContextService } from '../shared/agent-context.service';

interface InvitedRow {
  id: string;
  status: AgentReferralStatus;
  joinedAt: Date;
  firstName: string;
  lastName: string | null;
  jobsCompleted: number;
}

/** "Amit Kumar" → "Amit K.": enough to recognise someone, no more. */
function shortName(firstName: string, lastName: string | null) {
  const initial = lastName?.trim()?.[0];
  return initial ? `${firstName} ${initial.toUpperCase()}.` : firstName;
}

/** The numbers an agent may see behind a reason (not who else shares a bank account). */
function agentSafeDetail(detail: ReasonDetail | null) {
  if (!detail) return null;
  const { jobsDone, jobsRequired, windowDays, cap, remarks } = detail;
  return { jobsDone, jobsRequired, windowDays, cap, remarks };
}

/**
 * A reward as the agent sees it. Only people they invited themselves are
 * named; deeper levels are "your team".
 */
function toHistoryItem(row: RewardView) {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    from: row.type === 'DIRECT' ? shortName(row.referee.firstName, row.referee.lastName) : null,
    amount: row.amount,
    intendedAmount: row.intendedAmount,
    status: row.status,
    // Code and numbers let the app say it in the agent's language; `reason` is the English fallback.
    reasonCode: row.reasonCode,
    reasonDetail: agentSafeDetail(row.reasonDetail),
    reason: reasonText(
      row.reasonCode,
      row.reasonDetail,
      { intended: row.intendedAmount, amount: row.amount },
      'agent',
    ),
    salary: row.salary ? { month: row.salary.month, year: row.salary.year } : null,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
  };
}

/** The agent app's Refer & Earn screen and the signup form's code check. */
@Injectable()
export class AgentReferralsService {
  constructor(
    @InjectRepository(AgentReferral)
    private readonly referralRepo: Repository<AgentReferral>,
    private readonly context: AgentContextService,
    private readonly referrals: ReferralService,
    private readonly rewards: ReferralRewardsService,
  ) {}

  async overview(userId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    const config = await this.referrals.config();
    const employeeId =
      agent.employeeId ?? (await this.referrals.assignEmployeeId(agent.id));

    const [invited, summary] = await Promise.all([
      this.referralRepo
        .createQueryBuilder('referral')
        .innerJoin('referral.referee', 'referee')
        .select('referral.id', 'id')
        .addSelect('referral.status', 'status')
        .addSelect('referral.createdAt', 'joinedAt')
        .addSelect('referee.firstName', 'firstName')
        .addSelect('referee.lastName', 'lastName')
        .addSelect(jobsDoneSql('referee.id'), 'jobsCompleted')
        .where('referral.referrerAgentId = :agentId', { agentId: agent.id })
        .orderBy('referral.createdAt', 'ASC')
        .getRawMany<InvitedRow>(),
      this.rewards.summary(agent.id, config),
    ]);

    return {
      enabled: config.enabled,
      employeeId: formatEmployeeId(employeeId),
      invites: {
        used: invited.length,
        max: config.maxPerAgent,
        remaining: Math.max(config.maxPerAgent - invited.length, 0),
      },
      jobsToQualify: config.qualifyJobs,
      earnings: summary.totals,
      // Team rewards (level 2+) need the agent to be working themselves.
      activity: {
        ...summary.activity,
        applies: config.maxLevels > 1 && config.activeMinJobs > 0,
      },
      levels: summary.levels,
      joiningBonus: summary.joiningBonus ? toHistoryItem(summary.joiningBonus) : null,
      invited: invited.map((row) => ({
        id: row.id,
        name: shortName(row.firstName, row.lastName),
        joinedAt: row.joinedAt,
        status: row.status,
        jobsCompleted: Number(row.jobsCompleted),
      })),
      history: summary.history.filter((row) => row.type !== 'JOINING').map(toHistoryItem),
    };
  }

  async validate(userId: string, code: string) {
    const agent = await this.context.requireAgent(userId);
    const check = await this.referrals.checkCode(code, agent);
    if ('reason' in check) {
      return { valid: false, reason: check.reason, message: check.message };
    }
    return {
      valid: true,
      referrerName: shortName(check.referrer.firstName, check.referrer.lastName),
    };
  }
}
