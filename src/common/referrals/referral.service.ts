import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Agent, AgentReferral } from 'src/database/entities';
import { SettingsService } from 'src/common/services/settings.service';
import { readReferralConfig } from './referral-config';
import { generateEmployeeId, normalizeEmployeeId } from './employee-id';

/** Created at boot like the wallet tables. Mirrors sql/agent_referrals.sql. */
const REFERRAL_SCHEMA_SQL = `
ALTER TABLE agents ADD COLUMN IF NOT EXISTS employee_id VARCHAR(9);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS referred_by_agent_id UUID
  REFERENCES agents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_employee_id ON agents (employee_id);
CREATE INDEX IF NOT EXISTS idx_agents_referred_by ON agents (referred_by_agent_id);
CREATE TABLE IF NOT EXISTS agent_referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  referee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'JOINED',
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_referrals_referee
  ON agent_referrals (referee_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_referrals_referrer
  ON agent_referrals (referrer_agent_id);
CREATE TABLE IF NOT EXISTS agent_referral_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  referee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  level INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  intended_amount DECIMAL(10, 2) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  reason_code VARCHAR(30),
  reason_detail JSONB,
  salary_record_id UUID REFERENCES salary_records(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_reward_once
  ON agent_referral_rewards (referee_agent_id, agent_id, type);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_agent_id
  ON agent_referral_rewards (agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_salary_record_id
  ON agent_referral_rewards (salary_record_id);
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS referral_bonus DECIMAL(10, 2) NOT NULL DEFAULT 0;
`;

const ID_ATTEMPTS = 5;

export type ReferralCodeProblem =
  | 'PROGRAM_OFF'
  | 'INVALID'
  | 'OWN_CODE'
  | 'INACTIVE'
  | 'USED_UP'
  | 'NOT_NEW_AGENT'
  | 'ALREADY_REFERRED';

export type ReferralCodeCheck =
  | { valid: true; referrer: Agent }
  | { valid: false; reason: ReferralCodeProblem; message: string };

/**
 * Employee IDs and referral codes. An approved agent's employee ID is their
 * referral code; up to `maxPerAgent` new agents can sign up with it, ever.
 * Rewards for qualified referrals live with the earnings flow.
 */
@Injectable()
export class ReferralService implements OnModuleInit {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentReferral)
    private readonly referralRepo: Repository<AgentReferral>,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit() {
    try {
      await this.agentRepo.query(REFERRAL_SCHEMA_SQL);
      await this.backfillEmployeeIds();
    } catch (err) {
      this.logger.error('Failed to ensure agent referral schema; referrals will fail', err as Error);
    }
  }

  config() {
    return readReferralConfig(this.settings);
  }

  /** Approved agents from before referrals launched get their ID here. */
  private async backfillEmployeeIds() {
    const rows: { id: string }[] = await this.agentRepo.query(
      `SELECT id FROM agents WHERE approval_status = 'APPROVED' AND employee_id IS NULL`,
    );
    for (const row of rows) await this.assignEmployeeId(row.id);
    if (rows.length) this.logger.log(`Assigned employee IDs to ${rows.length} approved agents`);
  }

  /**
   * Gives the agent an employee ID if they don't have one, and returns it.
   * Never changes an existing ID. Not for use inside a transaction: a
   * collision is retried, and a failed statement would abort the transaction.
   */
  async assignEmployeeId(agentId: string): Promise<string | null> {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
      try {
        await this.agentRepo.query(
          `UPDATE agents SET employee_id = $1 WHERE id = $2 AND employee_id IS NULL`,
          [generateEmployeeId(), agentId],
        );
        break;
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    const agent = await this.agentRepo.findOne({
      where: { id: agentId },
      select: ['id', 'employeeId'],
    });
    return agent?.employeeId ?? null;
  }

  /** For the signup form: can `referee` use this code right now? */
  async checkCode(code: string, referee: Agent): Promise<ReferralCodeCheck> {
    const config = await this.config();
    return this.evaluate(code, referee, config.enabled, config.maxPerAgent, this.agentRepo, this.referralRepo);
  }

  /**
   * Links `referee` to the owner of `code` and uses up one of the owner's
   * invites. Re-sending the same code is a no-op; anything else that fails the
   * checks throws with a message the app can show as is.
   */
  async applyCode(referee: Agent, code: string): Promise<Agent> {
    const config = await this.config();

    return this.dataSource.transaction(async (manager) => {
      const agents = manager.getRepository(Agent);
      const current = await agents.findOne({
        where: { id: referee.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new BadRequestException('Agent not found');

      const check = await this.evaluate(
        code,
        current,
        config.enabled,
        config.maxPerAgent,
        agents,
        manager.getRepository(AgentReferral),
        true,
      );
      if ('reason' in check) {
        if (check.reason === 'ALREADY_REFERRED') {
          const same = await agents.findOne({
            where: { employeeId: normalizeEmployeeId(code) },
            select: ['id', 'firstName', 'lastName'],
          });
          if (same && same.id === current.referredByAgentId) return same;
        }
        throw check.reason === 'USED_UP' || check.reason === 'ALREADY_REFERRED'
          ? new ConflictException(check.message)
          : new BadRequestException(check.message);
      }

      await manager.query(
        `UPDATE agents SET referred_by_agent_id = $1 WHERE id = $2`,
        [check.referrer.id, current.id],
      );
      await manager.insert(AgentReferral, {
        referrerAgentId: check.referrer.id,
        refereeAgentId: current.id,
        status: 'JOINED',
      });
      return check.referrer;
    });
  }

  private async evaluate(
    code: string,
    referee: Agent,
    enabled: boolean,
    maxPerAgent: number,
    agents: Repository<Agent>,
    referrals: Repository<AgentReferral>,
    lockReferrer = false,
  ): Promise<ReferralCodeCheck> {
    const fail = (reason: ReferralCodeProblem, message: string) =>
      ({ valid: false, reason, message }) as const;

    if (!enabled) {
      return fail('PROGRAM_OFF', 'Referral codes are not being accepted right now');
    }
    if (referee.referredByAgentId) {
      return fail('ALREADY_REFERRED', 'A referral code has already been applied to your account');
    }
    // Only new agents: someone approved before (and so holding a code) can't
    // join another agent's team, which also rules out referral loops.
    if (referee.employeeId || referee.approvalStatus === 'APPROVED') {
      return fail('NOT_NEW_AGENT', 'Referral codes can only be used while signing up');
    }

    const employeeId = normalizeEmployeeId(code);
    const referrer = employeeId
      ? await agents.findOne({
          where: { employeeId },
          ...(lockReferrer ? { lock: { mode: 'pessimistic_write' as const } } : {}),
        })
      : null;
    if (!referrer) return fail('INVALID', 'This referral code does not exist');
    if (referrer.id === referee.id) {
      return fail('OWN_CODE', 'You cannot use your own referral code');
    }
    if (referrer.approvalStatus !== 'APPROVED' || referrer.status === 'SUSPENDED') {
      return fail('INACTIVE', 'This referral code is no longer active');
    }

    const used = await referrals.count({ where: { referrerAgentId: referrer.id } });
    if (used >= maxPerAgent) {
      return fail(
        'USED_UP',
        `This referral code has already been used by ${maxPerAgent} ${maxPerAgent === 1 ? 'person' : 'people'}`,
      );
    }
    return { valid: true, referrer };
  }
}
