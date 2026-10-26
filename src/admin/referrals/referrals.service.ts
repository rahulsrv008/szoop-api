import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Admin, Agent, AgentReferral, AgentReferralReward, AgentReferralStatus, SystemSetting } from 'src/database/entities';
import { SETTING_KEYS, SettingsService } from 'src/common/services/settings.service';
import { AuditService } from 'src/common/services/audit.service';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { ReferralService } from 'src/common/referrals/referral.service';
import { ReferralConfig } from 'src/common/referrals/referral-config';
import { ReferralRewardsService, RewardView, jobsDoneSql } from 'src/common/referrals/referral-rewards.service';
import { reasonText } from 'src/common/referrals/referral-reasons';
import { formatEmployeeId } from 'src/common/referrals/employee-id';
import { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto';
import { ReverseReferralRewardDto } from './dto/reverse-reward.dto';

/** Each field of the program and the system setting it's stored under. */
const SETTING_FIELDS: [keyof ReferralConfig, string][] = [
  ['enabled', SETTING_KEYS.REFERRAL_ENABLED],
  ['maxPerAgent', SETTING_KEYS.REFERRAL_MAX_PER_AGENT],
  ['maxLevels', SETTING_KEYS.REFERRAL_MAX_LEVELS],
  ['rewardTiers', SETTING_KEYS.REFERRAL_REWARD_TIERS],
  ['levelRewards', SETTING_KEYS.REFERRAL_LEVEL_REWARDS],
  ['maxEarning', SETTING_KEYS.REFERRAL_MAX_EARNING],
  ['qualifyJobs', SETTING_KEYS.REFERRAL_QUALIFY_JOBS],
  ['joiningBonus', SETTING_KEYS.REFERRAL_JOINING_BONUS],
  ['activeMinJobs', SETTING_KEYS.REFERRAL_ACTIVE_MIN_JOBS],
  ['activeWindowDays', SETTING_KEYS.REFERRAL_ACTIVE_WINDOW_DAYS],
];

/** The team tree on the agent page stops here, however many levels are paid. */
const TEAM_NODE_LIMIT = 200;

const TEAM_TREE_SQL = `
WITH RECURSIVE team AS (
  SELECT id, referred_by_agent_id AS parent_id, 1 AS level
    FROM agents WHERE referred_by_agent_id = $1
  UNION ALL
  SELECT a.id, a.referred_by_agent_id, team.level + 1
    FROM agents a JOIN team ON a.referred_by_agent_id = team.id
   WHERE team.level < $2
)
SELECT team.id AS "agentId", team.parent_id AS "parentId", team.level,
       a.first_name AS "firstName", a.last_name AS "lastName", a.employee_id AS "employeeId",
       a.status AS "accountStatus", r.status AS "referralStatus", r.created_at AS "joinedAt",
       ${jobsDoneSql('team.id')} AS "jobsCompleted"
  FROM team
  JOIN agents a ON a.id = team.id
  LEFT JOIN agent_referrals r ON r.referee_agent_id = team.id
 ORDER BY team.level, r.created_at
 LIMIT ${TEAM_NODE_LIMIT + 1}`;

interface TeamRow {
  agentId: string;
  parentId: string;
  level: number;
  firstName: string;
  lastName: string | null;
  employeeId: string | null;
  accountStatus: string;
  referralStatus: AgentReferralStatus | null;
  joinedAt: Date | null;
  jobsCompleted: number;
}

export interface TeamNode {
  agentId: string;
  name: string;
  employeeId: string | null;
  level: number;
  accountStatus: string;
  referralStatus: AgentReferralStatus | null;
  joinedAt: Date | null;
  jobsCompleted: number;
  team: TeamNode[];
}

const fullName = (firstName: string | null, lastName: string | null) =>
  [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unnamed agent';

const adminName = (admin: Pick<Admin, 'firstName' | 'lastName' | 'email'> | null) =>
  admin ? [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim() || admin.email : null;

/** Referral program settings and each agent's referral picture for the admin panel. */
@Injectable()
export class AdminReferralsService {
  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentReferral)
    private readonly referralRepo: Repository<AgentReferral>,
    @InjectRepository(AgentReferralReward)
    private readonly rewardRepo: Repository<AgentReferralReward>,
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
    private readonly settings: SettingsService,
    private readonly referrals: ReferralService,
    private readonly rewards: ReferralRewardsService,
    private readonly audit: AuditService,
    private readonly access: AdminAccessService,
  ) {}

  /** The values in force and who last changed them in the admin panel. */
  async getSettings() {
    const config = await this.referrals.config();
    const rows = await this.settingRepo.find({
      where: { settingKey: In(SETTING_FIELDS.map(([, key]) => key)) },
      order: { updatedAt: 'DESC' },
      take: 1,
    });
    const latest = rows[0];
    const admin = latest?.updatedBy
      ? await this.adminRepo.findOne({
          where: { id: latest.updatedBy },
          select: ['id', 'firstName', 'lastName', 'email'],
        })
      : null;

    return {
      ...config,
      lastChanged: latest
        ? {
            at: latest.updatedAt,
            by: adminName(admin),
          }
        : null,
    };
  }

  /** Saves the changed values. They apply from the next signup or qualification. */
  async updateSettings(adminId: string, dto: UpdateReferralSettingsDto) {
    if (dto.rewardTiers.length !== dto.maxPerAgent) {
      throw new BadRequestException(
        `Give one level 1 amount for each of the ${dto.maxPerAgent} invites`,
      );
    }
    if (dto.levelRewards.length !== dto.maxLevels - 1) {
      throw new BadRequestException(
        dto.maxLevels === 1
          ? 'Team rewards need no amounts when only level 1 is paid'
          : `Give one amount for each level from 2 to ${dto.maxLevels}`,
      );
    }

    const before = await this.referrals.config();
    const changed = SETTING_FIELDS.filter(
      ([field]) => JSON.stringify(before[field]) !== JSON.stringify(dto[field]),
    );
    for (const [field, key] of changed) {
      await this.settings.set(key, dto[field], { updatedBy: adminId });
    }

    if (changed.length) {
      await this.audit.record({
        userId: adminId,
        action: 'REFERRAL_SETTINGS_UPDATED',
        entityType: 'system_settings',
        entityId: null,
        oldData: Object.fromEntries(changed.map(([field]) => [field, before[field]])),
        newData: Object.fromEntries(changed.map(([field]) => [field, dto[field]])),
      });
    }
    return this.getSettings();
  }

  /** Everything for the Referrals section of the admin's agent page. */
  async agentReferrals(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    this.access.assertAgent(agent);

    const config = await this.referrals.config();
    const [summary, used, referredBy, teamRows] = await Promise.all([
      this.rewards.summary(agent.id, config),
      this.referralRepo.count({ where: { referrerAgentId: agent.id } }),
      agent.referredByAgentId
        ? this.agentRepo.findOne({
            where: { id: agent.referredByAgentId },
            select: ['id', 'firstName', 'lastName', 'employeeId'],
          })
        : null,
      this.agentRepo.query(TEAM_TREE_SQL, [agent.id, config.maxLevels]) as Promise<TeamRow[]>,
    ]);

    return {
      agentId: agent.id,
      employeeId: formatEmployeeId(agent.employeeId),
      referredBy: referredBy
        ? {
            agentId: referredBy.id,
            name: fullName(referredBy.firstName, referredBy.lastName),
            employeeId: formatEmployeeId(referredBy.employeeId),
          }
        : null,
      invites: {
        used,
        max: config.maxPerAgent,
        remaining: Math.max(config.maxPerAgent - used, 0),
      },
      jobsToQualify: config.qualifyJobs,
      totals: summary.totals,
      activity: {
        ...summary.activity,
        applies: config.maxLevels > 1 && config.activeMinJobs > 0,
      },
      levels: summary.levels,
      joiningBonus: summary.joiningBonus ? toAdminItem(summary.joiningBonus) : null,
      history: summary.history.filter((row) => row.type !== 'JOINING').map(toAdminItem),
      team: {
        members: buildTree(agent.id, teamRows.slice(0, TEAM_NODE_LIMIT)),
        truncated: teamRows.length > TEAM_NODE_LIMIT,
      },
    };
  }

  async reverseReward(adminId: string, rewardId: string, dto: ReverseReferralRewardDto) {
    const reward = await this.rewardRepo.findOne({ where: { id: rewardId } });
    if (!reward) throw new NotFoundException('Reward not found');
    const agent = await this.agentRepo.findOne({ where: { id: reward.agentId } });
    if (agent) this.access.assertAgent(agent);

    const admin = await this.adminRepo.findOne({
      where: { id: adminId },
      select: ['id', 'firstName', 'lastName', 'email'],
    });
    const { reward: reversed, wasPaid, before } = await this.rewards.reverse(
      rewardId,
      { id: adminId, name: adminName(admin) ?? 'an admin' },
      dto.remarks,
    );

    await this.audit.record({
      userId: adminId,
      action: 'REFERRAL_REWARD_REVERSED',
      entityType: 'agent_referral_rewards',
      entityId: reversed.id,
      oldData: before,
      newData: { status: reversed.status, remarks: dto.remarks, wasPaid },
    });

    const amount = Number(reversed.amount);
    return {
      id: reversed.id,
      status: reversed.status,
      amount,
      wasPaid,
      message: wasPaid
        ? `Reward reversed. ₹${amount} was already paid: add it as a deduction on a later salary to recover it.`
        : 'Reward reversed. It will not be paid.',
    };
  }
}

/** A reward as the admin sees it: everyone named, with the reason in full. */
function toAdminItem(row: RewardView) {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    from: {
      agentId: row.referee.agentId,
      name: fullName(row.referee.firstName, row.referee.lastName),
      employeeId: formatEmployeeId(row.referee.employeeId),
    },
    amount: row.amount,
    intendedAmount: row.intendedAmount,
    status: row.status,
    reasonCode: row.reasonCode,
    reason: reasonText(
      row.reasonCode,
      row.reasonDetail,
      { intended: row.intendedAmount, amount: row.amount },
      'admin',
    ),
    salary: row.salary,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    canReverse:
      (row.status === 'PENDING' || row.status === 'PAID') && row.salary?.status !== 'APPROVED',
  };
}

function buildTree(rootId: string, rows: TeamRow[]): TeamNode[] {
  const children = new Map<string, TeamNode[]>();
  for (const row of rows) {
    const node: TeamNode = {
      agentId: row.agentId,
      name: fullName(row.firstName, row.lastName),
      employeeId: formatEmployeeId(row.employeeId),
      level: Number(row.level),
      accountStatus: row.accountStatus,
      referralStatus: row.referralStatus,
      joinedAt: row.joinedAt,
      jobsCompleted: Number(row.jobsCompleted),
      team: [],
    };
    children.set(row.agentId, node.team);
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(node);
    children.set(row.parentId, siblings);
  }
  return children.get(rootId) ?? [];
}
