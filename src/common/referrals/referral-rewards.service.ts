import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Agent,
  AgentReferral,
  AgentReferralReward,
  ReferralRewardReason,
  ReferralRewardStatus,
  SalaryRecord,
} from 'src/database/entities';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { toDateString } from 'src/agent/shared/date.util';
import { ReferralService } from './referral.service';
import { ReferralConfig } from './referral-config';
import { ReasonDetail } from './referral-reasons';
import { formatEmployeeId } from './employee-id';

/**
 * Jobs an agent has finished: each done visit of a plan booking, plus each
 * completed booking without visits (same count as the work summary). With
 * `since`, only jobs on or after that date.
 */
export function jobsDoneSql(agentIdExpr: string, since?: string) {
  return `(
    (SELECT COUNT(*) FROM booking_visits v JOIN bookings b ON b.id = v.booking_id
      WHERE b.agent_id = ${agentIdExpr} AND v.status = 'done'${since ? ` AND v.visit_date >= ${since}` : ''})
    + (SELECT COUNT(*) FROM bookings b
      WHERE b.agent_id = ${agentIdExpr} AND b.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM booking_visits v WHERE v.booking_id = b.id)${
          since ? ` AND b.booking_date >= ${since}` : ''
        })
  )::int`;
}

/** The referee's upline, nearest first, up to `$2` levels. */
const UPLINE_SQL = `
WITH RECURSIVE chain AS (
  SELECT a.referred_by_agent_id AS agent_id, 1 AS level
    FROM agents a WHERE a.id = $1
  UNION ALL
  SELECT a.referred_by_agent_id, chain.level + 1
    FROM chain JOIN agents a ON a.id = chain.agent_id
   WHERE chain.level < $2
)
SELECT agent_id AS "agentId", level FROM chain WHERE agent_id IS NOT NULL ORDER BY level`;

/** How many agents are at each level below `$1`, and how many qualified. */
const TEAM_SQL = `
WITH RECURSIVE team AS (
  SELECT id, 1 AS level FROM agents WHERE referred_by_agent_id = $1
  UNION ALL
  SELECT a.id, team.level + 1
    FROM agents a JOIN team ON a.referred_by_agent_id = team.id
   WHERE team.level < $2
)
SELECT team.level,
       COUNT(*)::int AS people,
       COUNT(*) FILTER (WHERE r.status = 'QUALIFIED')::int AS qualified
  FROM team LEFT JOIN agent_referrals r ON r.referee_agent_id = team.id
 GROUP BY team.level ORDER BY team.level`;

type Decision = {
  status: ReferralRewardStatus;
  amount: number;
  reasonCode?: ReferralRewardReason;
  reasonDetail?: ReasonDetail;
};

/** A reward row with the people it concerns, for notifications and screens. */
export interface RewardView {
  id: string;
  type: AgentReferralReward['type'];
  level: number;
  intendedAmount: number;
  amount: number;
  status: ReferralRewardStatus;
  reasonCode: ReferralRewardReason | null;
  reasonDetail: ReasonDetail | null;
  referee: { agentId: string; firstName: string; lastName: string | null; employeeId: string | null };
  salary: { id: string; month: number; year: number; status: string } | null;
  createdAt: Date;
  paidAt: Date | null;
}

const isActiveAccount = (agent: Pick<Agent, 'approvalStatus' | 'status'>) =>
  agent.approvalStatus === 'APPROVED' && agent.status !== 'SUSPENDED';

const normalizeAccount = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, '').toUpperCase() || null;

const money = (value: number) => Number(value.toFixed(2));

/**
 * Rewards for qualified referrals. When a referee finishes the qualifying jobs,
 * everyone up to `maxLevels` above them gets a reward (or a recorded reason
 * why not), and the referee gets the joining bonus. Pending rewards are paid
 * with the monthly salary.
 */
@Injectable()
export class ReferralRewardsService {
  private readonly logger = new Logger(ReferralRewardsService.name);

  constructor(
    @InjectRepository(AgentReferral)
    private readonly referralRepo: Repository<AgentReferral>,
    @InjectRepository(AgentReferralReward)
    private readonly rewardRepo: Repository<AgentReferralReward>,
    private readonly dataSource: DataSource,
    private readonly referrals: ReferralService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  /** After an agent finishes a job. Never throws: a job is never failed over a reward. */
  async onJobCompleted(agentId: string) {
    try {
      await this.qualify(agentId);
    } catch (err) {
      this.logger.error(`Referral rewards failed for agent ${agentId}`, err as Error);
    }
  }

  /**
   * Qualifies the agent's referral once they have done enough jobs, creating
   * every reward in one transaction. Safe to call repeatedly: a referral
   * qualifies once. Rewards for a referral that already joined are honoured
   * even if the program has since been switched off.
   */
  async qualify(refereeId: string): Promise<AgentReferralReward[]> {
    const referral = await this.referralRepo.findOne({
      where: { refereeAgentId: refereeId, status: 'JOINED' },
    });
    if (!referral) return [];

    const config = await this.referrals.config();
    if ((await this.jobsDone(this.dataSource.manager, refereeId)) < config.qualifyJobs) return [];

    const outcome = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(AgentReferral, {
        where: { id: referral.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'JOINED') return null;

      const upline: { agentId: string; level: number }[] = await manager.query(UPLINE_SQL, [
        refereeId,
        config.maxLevels,
      ]);
      const ids = [refereeId, ...upline.map((row) => row.agentId)];
      // Locked in id order, so two referees sharing an upline can't deadlock;
      // the lock also keeps each agent's limit check honest.
      const agents = await manager
        .getRepository(Agent)
        .createQueryBuilder('agent')
        .where('agent.id IN (:...ids)', { ids })
        .orderBy('agent.id')
        .setLock('pessimistic_write')
        .getMany();
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      const referee = byId.get(refereeId)!;

      const sameBank = await this.sameBankAs(manager, refereeId, upline.map((row) => row.agentId));
      const sameBankDetail: ReasonDetail | null = sameBank
        ? {
            matchedName: [byId.get(sameBank)?.firstName, byId.get(sameBank)?.lastName].filter(Boolean).join(' '),
            matchedEmployeeId: formatEmployeeId(byId.get(sameBank)?.employeeId ?? null),
          }
        : null;

      const rows: Partial<AgentReferralReward>[] = [];
      for (const { agentId, level } of upline) {
        const intended =
          level === 1 ? await this.nextTierAmount(manager, agentId, config) : levelAmount(config, level);
        if (!(intended > 0)) continue;
        const decision: Decision = sameBankDetail
          ? missed('SAME_BANK_ACCOUNT', sameBankDetail)
          : await this.decide(manager, byId.get(agentId)!, level, intended, config);
        rows.push(toRow(agentId, refereeId, level, level === 1 ? 'DIRECT' : 'NETWORK', intended, decision));
      }
      if (config.joiningBonus > 0) {
        const decision: Decision = sameBankDetail
          ? missed('SAME_BANK_ACCOUNT', sameBankDetail)
          : isActiveAccount(referee)
            ? { status: 'PENDING', amount: config.joiningBonus }
            : missed('ACCOUNT_INACTIVE', { status: referee.status, approvalStatus: referee.approvalStatus });
        rows.push(toRow(refereeId, refereeId, 0, 'JOINING', config.joiningBonus, decision));
      }

      const saved = rows.length
        ? await manager.getRepository(AgentReferralReward).save(rows as AgentReferralReward[])
        : [];
      await manager.update(
        AgentReferral,
        { id: locked.id },
        { status: sameBank ? 'REJECTED' : 'QUALIFIED', qualifiedAt: new Date() },
      );
      return { saved, byId, referee };
    });
    if (!outcome) return [];

    await this.notify(outcome.saved, outcome.byId, outcome.referee, config);
    return outcome.saved;
  }

  /** Jobs the agent has finished, optionally only in the last `windowDays` days. */
  async jobsDone(manager: EntityManager, agentId: string, windowDays?: number) {
    const since = windowDays ? toDateString(daysAgo(windowDays)) : null;
    const [row] = await manager.query(
      `SELECT ${jobsDoneSql('$1', since ? '$2::date' : undefined)} AS jobs`,
      since ? [agentId, since] : [agentId],
    );
    return Number(row?.jobs ?? 0);
  }

  /**
   * Attaches the agent's pending rewards from before the end of the salary's
   * month, and returns the referral bonus: everything attached that isn't
   * missed or reversed. Rewards from later months wait for their own salary.
   */
  async attachToSalary(manager: EntityManager, salary: SalaryRecord) {
    const monthEnd = new Date(salary.year, salary.month, 1);
    await manager.query(
      `UPDATE agent_referral_rewards SET salary_record_id = $1
        WHERE agent_id = $2 AND status = 'PENDING' AND salary_record_id IS NULL AND created_at < $3`,
      [salary.id, salary.agentId, monthEnd],
    );
    return this.salaryBonus(manager, salary.id);
  }

  /**
   * Keeps attached rewards in step with the salary: PAID pays them, REJECTED
   * releases them for the next salary, anything else leaves them pending.
   * Returns the referral bonus now on the salary.
   */
  async syncWithSalary(manager: EntityManager, salary: SalaryRecord) {
    if (salary.status === 'PAID') {
      await manager.query(
        `UPDATE agent_referral_rewards SET status = 'PAID', paid_at = now()
          WHERE salary_record_id = $1 AND status = 'PENDING'`,
        [salary.id],
      );
    } else if (salary.status === 'REJECTED') {
      await manager.query(
        `UPDATE agent_referral_rewards SET status = 'PENDING', paid_at = NULL, salary_record_id = NULL
          WHERE salary_record_id = $1 AND status IN ('PENDING', 'PAID')`,
        [salary.id],
      );
    } else {
      await manager.query(
        `UPDATE agent_referral_rewards SET status = 'PENDING', paid_at = NULL
          WHERE salary_record_id = $1 AND status = 'PAID'`,
        [salary.id],
      );
    }
    return this.salaryBonus(manager, salary.id);
  }

  /**
   * Takes a pending or paid reward back. A reward on a pending salary comes
   * off that salary; one on an approved salary can't be reversed until the
   * salary is moved back to pending. Money already paid isn't recovered here:
   * `wasPaid` tells the admin to deduct it from a later salary.
   */
  async reverse(rewardId: string, admin: { id: string; name: string }, remarks: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const reward = await manager.findOne(AgentReferralReward, {
        where: { id: rewardId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reward) throw new NotFoundException('Reward not found');
      if (reward.status !== 'PENDING' && reward.status !== 'PAID') {
        throw new BadRequestException('Only pending or paid rewards can be reversed');
      }

      const salary = reward.salaryRecordId
        ? await manager.findOne(SalaryRecord, {
            where: { id: reward.salaryRecordId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (salary?.status === 'APPROVED') {
        throw new ConflictException(
          `This reward is on the approved ${salary.month}/${salary.year} salary. Move that salary back to pending first.`,
        );
      }

      const wasPaid = reward.status === 'PAID';
      const before = { status: reward.status, reasonCode: reward.reasonCode };
      reward.reasonDetail = {
        remarks,
        adminName: admin.name,
        previousStatus: reward.status,
        previousReason: reward.reasonCode,
      };
      reward.status = 'REVERSED';
      reward.reasonCode = 'ADMIN_REVERSED';
      reward.reversedBy = admin.id;
      reward.reversedAt = new Date();
      await manager.save(reward);

      if (salary && salary.status === 'PENDING') {
        const bonus = await this.salaryBonus(manager, salary.id);
        await manager.query(
          `UPDATE salary_records
              SET referral_bonus = $2, net_salary = fixed_salary + incentive + $2 - deductions
            WHERE id = $1`,
          [salary.id, bonus],
        );
      }
      return { reward, wasPaid, before };
    });

    const agent = await this.dataSource.getRepository(Agent).findOne({
      where: { id: result.reward.agentId },
      select: ['id', 'userId'],
    });
    if (agent) {
      try {
        await this.notifications.toUser(agent.userId, {
          app: 'agent',
          type: 'referral',
          title: 'Referral reward taken back',
          message: `Your ₹${Number(result.reward.amount)} referral reward was taken back. ${remarks}`,
        });
      } catch (err) {
        this.logger.warn(`Referral notification failed for agent ${agent.id}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async salaryBonus(manager: EntityManager, salaryId: string) {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM agent_referral_rewards
        WHERE salary_record_id = $1 AND status IN ('PENDING', 'PAID')`,
      [salaryId],
    );
    return Number(row?.total ?? 0);
  }

  /** Everything the Refer & Earn screen and the admin's agent page show. */
  async summary(agentId: string, config: ReferralConfig) {
    const manager = this.dataSource.manager;
    const [totals, team, rewards, recentJobs] = await Promise.all([
      manager.query(
        // Referral earnings only (what the limit counts); the joining bonus is shown on its own.
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING', 'PAID')), 0) AS earned,
           COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0) AS paid,
           COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0) AS pending,
           COALESCE(SUM(intended_amount - amount) FILTER (WHERE status <> 'REVERSED'), 0) AS missed,
           COUNT(*) FILTER (WHERE status = 'MISSED')::int AS "missedCount"
         FROM agent_referral_rewards WHERE agent_id = $1 AND type <> 'JOINING'`,
        [agentId],
      ),
      manager.query(TEAM_SQL, [agentId, config.maxLevels]),
      this.rewardRepo
        .createQueryBuilder('reward')
        .innerJoin('reward.referee', 'referee')
        .leftJoin('reward.salaryRecord', 'salary')
        .select([
          'reward.id AS id',
          'reward.type AS type',
          'reward.level AS level',
          'reward.intended_amount AS "intendedAmount"',
          'reward.amount AS amount',
          'reward.status AS status',
          'reward.reason_code AS "reasonCode"',
          'reward.reason_detail AS "reasonDetail"',
          'reward.created_at AS "createdAt"',
          'reward.paid_at AS "paidAt"',
          'referee.id AS "refereeId"',
          'referee.first_name AS "refereeFirstName"',
          'referee.last_name AS "refereeLastName"',
          'referee.employee_id AS "refereeEmployeeId"',
          'salary.id AS "salaryId"',
          'salary.month AS "salaryMonth"',
          'salary.year AS "salaryYear"',
          'salary.status AS "salaryStatus"',
        ])
        .where('reward.agent_id = :agentId', { agentId })
        .orderBy('reward.created_at', 'DESC')
        .getRawMany(),
      this.jobsDone(manager, agentId, config.activeWindowDays),
    ]);

    const t = totals[0] ?? {};
    const byLevel = new Map<number, { people: number; qualified: number }>(
      team.map((row: { level: number; people: number; qualified: number }) => [
        Number(row.level),
        { people: Number(row.people), qualified: Number(row.qualified) },
      ]),
    );
    const history: RewardView[] = rewards.map((row) => ({
      id: row.id,
      type: row.type,
      level: Number(row.level),
      intendedAmount: Number(row.intendedAmount),
      amount: Number(row.amount),
      status: row.status,
      reasonCode: row.reasonCode,
      reasonDetail: row.reasonDetail,
      referee: {
        agentId: row.refereeId,
        firstName: row.refereeFirstName,
        lastName: row.refereeLastName,
        employeeId: row.refereeEmployeeId,
      },
      salary: row.salaryId
        ? { id: row.salaryId, month: Number(row.salaryMonth), year: Number(row.salaryYear), status: row.salaryStatus }
        : null,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
    }));

    const levels = Array.from({ length: config.maxLevels }, (_, i) => i + 1);
    return {
      totals: {
        earned: Number(t.earned ?? 0),
        limit: config.maxEarning,
        paid: Number(t.paid ?? 0),
        pending: Number(t.pending ?? 0),
        missed: Number(t.missed ?? 0),
        missedCount: Number(t.missedCount ?? 0),
      },
      activity: {
        jobsDone: recentJobs,
        jobsRequired: config.activeMinJobs,
        windowDays: config.activeWindowDays,
        unlocked: recentJobs >= config.activeMinJobs,
      },
      levels: levels.map((level) => {
        const rows = history.filter((row) => row.level === level);
        const sum = (pick: (row: RewardView) => boolean, field: 'amount' | 'missed') =>
          money(
            rows
              .filter(pick)
              .reduce((total, row) => total + (field === 'amount' ? row.amount : row.intendedAmount - row.amount), 0),
          );
        return {
          level,
          people: byLevel.get(level)?.people ?? 0,
          qualified: byLevel.get(level)?.qualified ?? 0,
          earned: sum((row) => row.status === 'PENDING' || row.status === 'PAID', 'amount'),
          paid: sum((row) => row.status === 'PAID', 'amount'),
          pending: sum((row) => row.status === 'PENDING', 'amount'),
          missed: sum((row) => row.status !== 'REVERSED', 'missed'),
        };
      }),
      joiningBonus: history.find((row) => row.type === 'JOINING') ?? null,
      history,
    };
  }

  private async decide(
    manager: EntityManager,
    agent: Agent,
    level: number,
    intended: number,
    config: ReferralConfig,
  ): Promise<Decision> {
    if (!isActiveAccount(agent)) {
      return missed('ACCOUNT_INACTIVE', { status: agent.status, approvalStatus: agent.approvalStatus });
    }
    if (level >= 2 && config.activeMinJobs > 0) {
      const jobsDone = await this.jobsDone(manager, agent.id, config.activeWindowDays);
      if (jobsDone < config.activeMinJobs) {
        return missed('INACTIVE', {
          jobsDone,
          jobsRequired: config.activeMinJobs,
          windowDays: config.activeWindowDays,
        });
      }
    }
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(amount), 0) AS earned FROM agent_referral_rewards
        WHERE agent_id = $1 AND type IN ('DIRECT', 'NETWORK') AND status IN ('PENDING', 'PAID')`,
      [agent.id],
    );
    const earned = Number(row?.earned ?? 0);
    const left = money(Math.max(config.maxEarning - earned, 0));
    if (left <= 0) return missed('CAP_REACHED', { cap: config.maxEarning, earned });
    if (intended > left) {
      return {
        status: 'PENDING',
        amount: left,
        reasonCode: 'CAP_PARTIAL',
        reasonDetail: { cap: config.maxEarning, earned },
      };
    }
    return { status: 'PENDING', amount: intended };
  }

  /** Level 1 rewards go by the order the agent's referees qualify. */
  private async nextTierAmount(manager: EntityManager, agentId: string, config: ReferralConfig) {
    const [row] = await manager.query(
      `SELECT COUNT(*)::int AS n FROM agent_referral_rewards WHERE agent_id = $1 AND type = 'DIRECT'`,
      [agentId],
    );
    const tiers = config.rewardTiers;
    return tiers[Math.min(Number(row?.n ?? 0), tiers.length - 1)];
  }

  /** The upline agent (if any) sharing the referee's payout bank account. */
  private async sameBankAs(manager: EntityManager, refereeId: string, uplineIds: string[]) {
    if (!uplineIds.length) return null;
    const rows: { agentId: string; accountNumber: string | null }[] = await manager.query(
      `SELECT agent_id AS "agentId", account_number AS "accountNumber"
         FROM agent_bank_accounts WHERE agent_id = ANY($1::uuid[])`,
      [[refereeId, ...uplineIds]],
    );
    const own = normalizeAccount(rows.find((row) => row.agentId === refereeId)?.accountNumber);
    if (!own) return null;
    return (
      uplineIds.find((id) =>
        rows.some((row) => row.agentId === id && normalizeAccount(row.accountNumber) === own),
      ) ?? null
    );
  }

  private async notify(
    rewards: AgentReferralReward[],
    agents: Map<string, Agent>,
    referee: Agent,
    config: ReferralConfig,
  ) {
    const jobs = config.qualifyJobs;
    for (const reward of rewards) {
      const agent = agents.get(reward.agentId);
      const amount = Number(reward.amount);
      const detail = (reward.reasonDetail ?? {}) as ReasonDetail;
      const who = reward.type === 'DIRECT' ? referee.firstName : 'Someone in your team';
      let message: { title: string; message: string } | null = null;

      if (reward.status === 'PENDING') {
        const cut = reward.reasonCode === 'CAP_PARTIAL' ? ` That takes you to your ₹${detail.cap} limit.` : '';
        message =
          reward.type === 'JOINING'
            ? {
                title: 'Joining bonus earned',
                message: `You completed ${jobs} jobs. Your ₹${amount} joining bonus will be paid with your salary.`,
              }
            : {
                title: reward.type === 'DIRECT' ? 'Referral reward earned' : 'Team reward earned',
                message: `${who} completed ${jobs} jobs. ₹${amount} will be paid with your salary.${cut}`,
              };
      } else if (reward.reasonCode === 'INACTIVE') {
        message = {
          title: 'Team reward missed',
          message: `${who} completed ${jobs} jobs, but you had ${detail.jobsDone} of ${detail.jobsRequired} jobs in the last ${detail.windowDays} days, so ₹${Number(reward.intendedAmount)} was missed. Stay active so you don't miss the next one.`,
        };
      } else if (reward.reasonCode === 'CAP_REACHED') {
        message = {
          title: 'Referral limit reached',
          message: `${who} completed ${jobs} jobs, but you have already earned the ₹${detail.cap} referral limit.`,
        };
      }
      // Suspended accounts and same-bank referrals are for the admin to follow up.
      if (!message || !agent) continue;
      try {
        await this.notifications.toUser(agent.userId, { app: 'agent', type: 'referral', ...message });
      } catch (err) {
        this.logger.warn(`Referral notification failed for agent ${agent.id}: ${(err as Error).message}`);
      }
    }
  }
}

function levelAmount(config: ReferralConfig, level: number) {
  const amounts = config.levelRewards;
  return amounts[Math.min(level - 2, amounts.length - 1)];
}

function missed(reasonCode: ReferralRewardReason, reasonDetail: ReasonDetail): Decision {
  return { status: 'MISSED', amount: 0, reasonCode, reasonDetail };
}

function toRow(
  agentId: string,
  refereeAgentId: string,
  level: number,
  type: AgentReferralReward['type'],
  intended: number,
  decision: Decision,
): Partial<AgentReferralReward> {
  return {
    agentId,
    refereeAgentId,
    level,
    type,
    intendedAmount: intended.toFixed(2),
    amount: decision.amount.toFixed(2),
    status: decision.status,
    reasonCode: decision.reasonCode ?? null,
    reasonDetail: (decision.reasonDetail as Record<string, unknown>) ?? null,
  };
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
