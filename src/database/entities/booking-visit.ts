import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Booking } from './booking';

export type BookingVisitShift = 'morning' | 'evening' | 'visit';
export type BookingVisitStatus = 'pending' | 'active' | 'done';

@Entity('booking_visits')
export class BookingVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_booking_visits_booking_id')
  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'visit_date', type: 'date' })
  visitDate: string;

  @Column({ type: 'varchar', length: 20 })
  shift: BookingVisitShift;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ type: 'varchar', length: 8 })
  otp: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: BookingVisitStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
