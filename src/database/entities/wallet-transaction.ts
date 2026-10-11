import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Customer } from './customer';
import { Booking } from './booking';

export type WalletTransactionType = 'CREDIT' | 'DEBIT';

/**
 * BOOKING_CANCELLED / BOOKING_EXPIRED: a refund (CREDIT). UNPAID_BOOKING: the
 * customer didn't pay for a completed pay-after-service job, so they owe it
 * (DEBIT). DUE_PAID: they paid it later (CREDIT, clears the debit).
 */
export type WalletTransactionReason =
  | 'BOOKING_CANCELLED'
  | 'BOOKING_EXPIRED'
  | 'UNPAID_BOOKING'
  | 'DUE_PAID';

/**
 * The customer wallet ledger: the balance is the sum of these rows (credits
 * minus debits), so every rupee traces back to a booking. It goes negative
 * when the customer owes for a job. A booking is refunded at most once, and
 * its due is recorded and cleared at most once.
 */
@Entity('wallet_transactions')
@Index('uq_wallet_refund_once', ['bookingId'], {
  unique: true,
  where: `reason IN ('BOOKING_CANCELLED', 'BOOKING_EXPIRED')`,
})
@Index('uq_wallet_due_once', ['bookingId', 'reason'], {
  unique: true,
  where: `reason IN ('UNPAID_BOOKING', 'DUE_PAID')`,
})
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_wallet_transactions_customer_id')
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId: string | null;

  @ManyToOne(() => Booking, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking | null;

  @Column({ type: 'varchar', length: 10 })
  type: WalletTransactionType;

  @Column({ type: 'varchar', length: 40 })
  reason: WalletTransactionReason;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
