import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Agent } from './agent';

@Entity('salary_records')
export class SalaryRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, (agent) => agent.salaryRecords)
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'int' })
  year: number;

  @Column({ name: 'fixed_salary', type: 'decimal', precision: 10, scale: 2, default: 12000 })
  fixedSalary: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  incentive: string;

  /** Referral rewards attached to this salary (agent_referral_rewards). */
  @Column({ name: 'referral_bonus', type: 'decimal', precision: 10, scale: 2, default: 0 })
  referralBonus: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deductions: string;

  @Column({ name: 'net_salary', type: 'decimal', precision: 10, scale: 2, default: 0 })
  netSalary: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
