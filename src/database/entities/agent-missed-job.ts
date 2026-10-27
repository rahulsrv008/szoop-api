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
import { Booking } from './booking';

export type MissedJobReason =
  /** Accepted, but no "I'm on my way" by the cut-off: the job went to someone else. */
  | 'NO_ON_THE_WAY'
  /** "Right now": no closer to the customer 10 minutes after setting off. */
  | 'NOT_MOVING'
  /** The start time passed and the customer asked for another expert. */
  | 'CUSTOMER_REPLACED'
  /** On the way, but not started 30 minutes after the start time: cancelled. */
  | 'NOT_STARTED'
  /** A plan visit not started 30 minutes after its time (flagged, nothing changed). */
  | 'PLAN_VISIT_MISSED';

/** One job an agent held and didn't do, for the admin panel's Missed jobs page. */
@Entity('agent_missed_jobs')
@Index('uq_agent_missed_jobs_once', ['bookingId', 'agentId', 'reason', 'slot'], { unique: true })
@Index('idx_agent_missed_jobs_agent', ['agentId', 'createdAt'])
export class AgentMissedJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'varchar', length: 30 })
  reason: MissedJobReason;

  /** The start time (or plan visit) the agent missed. */
  @Column({ type: 'timestamptz' })
  slot: Date;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  /** When an admin last sent this agent a warning that covered this job. */
  @Column({ name: 'warned_at', type: 'timestamptz', nullable: true })
  warnedAt: Date | null;

  @Column({ name: 'warned_by', type: 'uuid', nullable: true })
  warnedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
