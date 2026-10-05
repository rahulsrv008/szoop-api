import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Booking } from './booking';

/**
 * searching → offers going out wave by wave
 * exhausted → every wave ran dry; retried slowly while the job stays open
 * assigned  → an agent holds the job
 * closed    → cancelled, or its start time passed while still open
 */
export type BookingDispatchStatus = 'searching' | 'exhausted' | 'assigned' | 'closed';

/** Dispatcher state for one booking; `next_action_at` is when the tick should look at it again. */
@Entity('booking_dispatches')
export class BookingDispatch {
  @PrimaryColumn({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @OneToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'varchar', length: 20, default: 'searching' })
  status: BookingDispatchStatus;

  /** Last wave that went out (0 = none yet). */
  @Column({ type: 'int', default: 0 })
  wave: number;

  @Index('idx_booking_dispatches_next_action')
  @Column({ name: 'next_action_at', type: 'timestamptz', nullable: true })
  nextActionAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
