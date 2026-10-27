import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  OneToMany,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from './user';
import { Booking } from './booking';
import { AgentAvailability } from './agent-availability';
import { AgentLocation } from './agent-location';
import { AgentAttendance } from './agent-attendance';
import { AgentDocument } from './agent-document';
import { AgentBankAccount } from './agent-bank-account';
import { AgentEarning } from './agent-earning';
import { AgentIncentive } from './agent-incentive';
import { SalaryRecord } from './salary-record';
import { Rating } from './rating';
import { AgentSkill } from './agent-skill';
import { ServiceArea } from './service-area';

export interface AgentCurrentLocation {
  latitude: number;
  longitude: number;
  recordedAt: string;
}

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, (user) => user.agent)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'first_name', type: 'varchar', length: 100, default: '' })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ name: 'profile_image', type: 'text', nullable: true })
  profileImage: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gender: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: string;

  @Column({ name: 'approval_status', type: 'varchar', length: 30, default: 'PENDING' })
  approvalStatus: string;

  @Column({ name: 'joining_date', type: 'date', nullable: true })
  joiningDate: string | null;

  @Column({ name: 'boost_enabled', type: 'boolean', default: false })
  boostEnabled: boolean;

  @Column({ name: 'address_line1', type: 'varchar', length: 255, nullable: true })
  addressLine1: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  locality: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  pincode: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: string | null;

  @Column({ name: 'home_zone', type: 'uuid', nullable: true })
  homeZoneId: string | null;

  @ManyToOne(() => ServiceArea, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'home_zone' })
  homeZone: ServiceArea | null;

  @Column({
    name: 'service_areas',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  serviceAreas: string[];

  @Column({ name: 'current_location', type: 'jsonb', nullable: true })
  currentLocation: AgentCurrentLocation | null;

  /** H3 res-8 cell of currentLocation; kept in step with it on every write. */
  @Column({ name: 'current_h3_cell', type: 'varchar', length: 16, nullable: true })
  currentH3Cell: string | null;

  /** H3 res-8 cell of the registered home address; the dispatcher's fallback when the GPS fix is stale. */
  @Column({ name: 'home_h3_cell', type: 'varchar', length: 16, nullable: true })
  homeH3Cell: string | null;

  /**
   * SZ + year + 5 random characters, set on approval. Also the referral code.
   * `update: false`: only ReferralService writes it (with SQL), so saving an
   * agent loaded before the ID was assigned can't clear it.
   */
  @Index('uq_agents_employee_id', { unique: true })
  @Column({ name: 'employee_id', type: 'varchar', length: 9, nullable: true, update: false })
  employeeId: string | null;

  /** Set once by ReferralService, when the agent signs up with someone's code. */
  @Index('idx_agents_referred_by')
  @Column({ name: 'referred_by_agent_id', type: 'uuid', nullable: true, update: false })
  referredByAgentId: string | null;

  @ManyToOne(() => Agent, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'referred_by_agent_id' })
  referredBy: Agent | null;

  @OneToMany(() => Booking, (booking) => booking.agent)
  bookings: Booking[];

  @OneToMany(() => AgentAvailability, (row) => row.agent)
  availability: AgentAvailability[];

  @OneToMany(() => AgentLocation, (row) => row.agent)
  locations: AgentLocation[];

  @OneToMany(() => AgentAttendance, (row) => row.agent)
  attendance: AgentAttendance[];

  @OneToMany(() => AgentDocument, (row) => row.agent)
  documents: AgentDocument[];

  @OneToMany(() => AgentBankAccount, (row) => row.agent)
  bankAccounts: AgentBankAccount[];

  @OneToMany(() => AgentEarning, (row) => row.agent)
  earnings: AgentEarning[];

  @OneToMany(() => AgentIncentive, (row) => row.agent)
  incentives: AgentIncentive[];

  @OneToMany(() => SalaryRecord, (row) => row.agent)
  salaryRecords: SalaryRecord[];

  @OneToMany(() => Rating, (rating) => rating.agent)
  ratings: Rating[];

  @OneToMany(() => AgentSkill, (row) => row.agent)
  skills: AgentSkill[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
