import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Booking } from './booking';
import { Agent } from './agent';

export type BookingOfferStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  /** The agent held the job and gave it back (or was a no-show) — counts against their release limit. */
  | 'released'
  | 'expired'
  | 'cancelled';

/** One push offer of an open job to one agent, made by the dispatcher in waves. */
@Entity('booking_offers')
@Index('uq_booking_offers_booking_agent', ['bookingId', 'agentId'], { unique: true })
export class BookingOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Index('idx_booking_offers_agent_id')
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'int' })
  wave: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: BookingOfferStatus;

  /** Agent → job straight-line km when offered; null when matched by zone without a GPS fix. */
  @Column({ name: 'distance_km', type: 'decimal', precision: 6, scale: 2, nullable: true })
  distanceKm: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
