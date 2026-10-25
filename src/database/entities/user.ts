import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { Customer } from './customer';
import { Agent } from './agent';
import { RefreshToken } from './refresh-token';
import { Notification } from './notification';
import { SupportTicket } from './support-ticket';
import { DeviceToken } from './device-token';

export type UserType = 'customer' | 'agent' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 15, unique: true })
  mobile: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'user_type', type: 'varchar', length: 20 })
  userType: UserType;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Set when the customer asked to delete. Login on this number starts a new customer. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToOne(() => Customer, (customer) => customer.user)
  customer: Customer | null;

  @OneToOne(() => Agent, (agent) => agent.user)
  agent: Agent | null;

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens: RefreshToken[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  @OneToMany(() => SupportTicket, (ticket) => ticket.user)
  supportTickets: SupportTicket[];

  @OneToMany(() => DeviceToken, (deviceToken) => deviceToken.user)
  deviceTokens: DeviceToken[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
