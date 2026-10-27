import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Agent } from './agent';
import { SalaryRecord } from './salary-record';

/**
 * DIRECT: the agent invited the referee (level 1). NETWORK: the referee is
 * deeper in the agent's team (level 2+). JOINING: the referee's own bonus.
 */
export type ReferralRewardType = 'DIRECT' | 'NETWORK' | 'JOINING';

/**
 * PENDING: waiting for (or attached to) a salary that isn't paid yet.
 * MISSED: not given; `reason_code` says why. REVERSED: taken back by an admin.
 */
export type ReferralRewardStatus = 'PENDING' | 'PAID' | 'MISSED' | 'REVERSED';

export type ReferralRewardReason =
  | 'INACTIVE'
  | 'CAP_REACHED'
  | 'CAP_PARTIAL'
  | 'ACCOUNT_INACTIVE'
  | 'SAME_BANK_ACCOUNT'
  | 'ADMIN_REVERSED';

/**
 * One row per reward an agent got, or would have got, when a referee completed
 * the qualifying jobs. Missed rewards are kept, with the numbers behind the
 * reason, so the admin panel and the app can say why. Paid through the monthly
 * salary (`salary_record_id`). Mirrors sql/agent_referrals.sql.
 */
@Entity('agent_referral_rewards')
@Index('uq_referral_reward_once', ['refereeAgentId', 'agentId', 'type'], { unique: true })
export class AgentReferralReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Who receives it. */
  @Index('idx_referral_rewards_agent_id')
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  /** Whose qualifying jobs triggered it. */
  @Column({ name: 'referee_agent_id', type: 'uuid' })
  refereeAgentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referee_agent_id' })
  referee: Agent;

  /** Levels between the two agents; 0 for the joining bonus. */
  @Column({ type: 'int' })
  level: number;

  @Column({ type: 'varchar', length: 20 })
  type: ReferralRewardType;

  /** What the settings said it was worth. */
  @Column({ name: 'intended_amount', type: 'decimal', precision: 10, scale: 2 })
  intendedAmount: string;

  /** What the agent actually gets: 0 when missed, less when the limit cut it. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 20 })
  status: ReferralRewardStatus;

  @Column({ name: 'reason_code', type: 'varchar', length: 30, nullable: true })
  reasonCode: ReferralRewardReason | null;

  /** The numbers behind the reason, as they were then (jobs done, limit…). */
  @Column({ name: 'reason_detail', type: 'jsonb', nullable: true })
  reasonDetail: Record<string, unknown> | null;

  @Index('idx_referral_rewards_salary_record_id')
  @Column({ name: 'salary_record_id', type: 'uuid', nullable: true })
  salaryRecordId: string | null;

  @ManyToOne(() => SalaryRecord, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'salary_record_id' })
  salaryRecord: SalaryRecord | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'reversed_by', type: 'uuid', nullable: true })
  reversedBy: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
