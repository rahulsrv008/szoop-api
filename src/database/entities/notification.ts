import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user';

/** The app a notification or registered phone belongs to (one user can be both a customer and an agent). */
export type NotificationApp = 'customer' | 'agent';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_notifications_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.notifications)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ name: 'notification_type', type: 'varchar', length: 50, nullable: true })
  notificationType: string | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  /** Which app this belongs to, so the customer and agent apps never get each other's. Null: older rows. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  app: NotificationApp | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
