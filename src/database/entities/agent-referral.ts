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

/**
 * JOINED: the referee signed up with the code. QUALIFIED: they completed the
 * required jobs and rewards were created. REJECTED: an admin found it invalid.
 */
export type AgentReferralStatus = 'JOINED' | 'QUALIFIED' | 'REJECTED';

/**
 * One row per use of a referral code. Every row counts towards the referrer's
 * limit for good, whatever its status. Mirrors sql/agent_referrals.sql.
 */
@Entity('agent_referrals')
export class AgentReferral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_agent_referrals_referrer')
  @Column({ name: 'referrer_agent_id', type: 'uuid' })
  referrerAgentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referrer_agent_id' })
  referrer: Agent;

  @Index('uq_agent_referrals_referee', { unique: true })
  @Column({ name: 'referee_agent_id', type: 'uuid' })
  refereeAgentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referee_agent_id' })
  referee: Agent;

  @Column({ type: 'varchar', length: 20, default: 'JOINED' })
  status: AgentReferralStatus;

  @Column({ name: 'qualified_at', type: 'timestamptz', nullable: true })
  qualifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
