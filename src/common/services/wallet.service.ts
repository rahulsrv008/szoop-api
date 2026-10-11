import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  Booking,
  Payment,
  WalletTransaction,
  WalletTransactionReason,
} from 'src/database/entities';
import { PaginationQueryDto, paginated, skipTake } from 'src/common/dto/pagination.dto';

/** Created at boot like the dispatch tables. Mirrors sql/customer_wallet.sql. */
const WALLET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL,
  reason VARCHAR(40) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_customer_id
  ON wallet_transactions (customer_id);
DROP INDEX IF EXISTS uq_wallet_transactions_refund;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_refund_once
  ON wallet_transactions (booking_id) WHERE reason IN ('BOOKING_CANCELLED', 'BOOKING_EXPIRED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_due_once
  ON wallet_transactions (booking_id, reason) WHERE reason IN ('UNPAID_BOOKING', 'DUE_PAID');
`;

/**
 * Customer wallet. Payments are mocked, so a refund for a cancelled or
 * expired booking is credited here instead of going back to the gateway.
 */
@Injectable()
export class WalletService implements OnModuleInit {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(WalletTransaction)
    private readonly walletRepo: Repository<WalletTransaction>,
  ) {}

  async onModuleInit() {
    try {
      await this.walletRepo.query(WALLET_SCHEMA_SQL);
    } catch (err) {
      this.logger.error('Failed to ensure wallet_transactions; wallet refunds will fail', err as Error);
    }
  }

  /**
   * Credits what the customer paid for this booking: pass the payment as it was
   * before being marked REFUNDED. Only a collected payment is refunded, and only
   * once per booking. Returns the amount credited (0 if none).
   */
  async refundBooking(
    booking: Pick<Booking, 'id' | 'customerId'>,
    payment: Pick<Payment, 'amount' | 'paymentStatus'> | null,
    reason: WalletTransactionReason,
    manager?: EntityManager,
  ) {
    const amount = payment?.paymentStatus === 'PAID' ? Number(payment.amount) : 0;
    if (!(amount > 0)) return 0;

    const repo = manager ? manager.getRepository(WalletTransaction) : this.walletRepo;
    const result = await repo
      .createQueryBuilder()
      .insert()
      .values({
        customerId: booking.customerId,
        bookingId: booking.id,
        type: 'CREDIT',
        reason,
        amount: amount.toFixed(2),
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    return (result.raw as unknown[]).length ? amount : 0;
  }

  /**
   * The customer didn't pay for a completed job: they owe its amount, so the
   * wallet goes down by it (and can go negative). Recorded once per booking.
   */
  async recordDue(
    booking: Pick<Booking, 'id' | 'customerId' | 'totalAmount'>,
    manager?: EntityManager,
  ) {
    const amount = Number(booking.totalAmount);
    if (!(amount > 0)) return 0;
    return this.insertOnce(manager, {
      customerId: booking.customerId,
      bookingId: booking.id,
      type: 'DEBIT',
      reason: 'UNPAID_BOOKING',
      amount: amount.toFixed(2),
    });
  }

  /** The customer paid a booking they owed: clear its due. Returns the amount cleared (0 if none was owed). */
  async settleDue(bookingId: string, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(WalletTransaction) : this.walletRepo;
    const due = await repo.findOne({ where: { bookingId, reason: 'UNPAID_BOOKING' } });
    if (!due) return 0;
    return this.insertOnce(manager, {
      customerId: due.customerId,
      bookingId,
      type: 'CREDIT',
      reason: 'DUE_PAID',
      amount: due.amount,
    });
  }

  private async insertOnce(
    manager: EntityManager | undefined,
    row: Pick<WalletTransaction, 'customerId' | 'bookingId' | 'type' | 'reason' | 'amount'>,
  ) {
    const repo = manager ? manager.getRepository(WalletTransaction) : this.walletRepo;
    const result = await repo.createQueryBuilder().insert().values(row).orIgnore().returning(['id']).execute();
    return (result.raw as unknown[]).length ? Number(row.amount) : 0;
  }

  async balance(customerId: string) {
    const row = await this.walletRepo
      .createQueryBuilder('tx')
      .select(
        `COALESCE(SUM(CASE WHEN tx.type = 'CREDIT' THEN tx.amount ELSE -tx.amount END), 0)`,
        'balance',
      )
      .where('tx.customerId = :customerId', { customerId })
      .getRawOne<{ balance: string }>();
    return Number(row?.balance ?? 0);
  }

  /** Bookings the customer still owes for (completed unpaid, not paid since), oldest first. */
  async outstandingDues(customerId: string) {
    const rows = await this.walletRepo.find({
      where: { customerId, reason: In(['UNPAID_BOOKING', 'DUE_PAID']) },
      relations: ['booking'],
      order: { createdAt: 'ASC' },
    });
    const cleared = new Set(rows.filter((row) => row.reason === 'DUE_PAID').map((row) => row.bookingId));
    return rows
      .filter((row) => row.reason === 'UNPAID_BOOKING' && !cleared.has(row.bookingId))
      .map((row) => ({
        bookingId: row.bookingId as string,
        bookingNumber: row.booking?.bookingNumber ?? null,
        amount: Number(row.amount),
      }));
  }

  /** Balance plus the latest transactions, newest first, and what is still owed. */
  async statement(customerId: string, query: PaginationQueryDto) {
    const [balance, dues, [rows, total]] = await Promise.all([
      this.balance(customerId),
      this.outstandingDues(customerId),
      this.walletRepo.findAndCount({
        where: { customerId },
        relations: ['booking'],
        order: { createdAt: 'DESC' },
        ...skipTake(query),
      }),
    ]);
    return {
      balance,
      dues,
      ...paginated(rows.map((row) => this.toItem(row)), total, query),
    };
  }

  /** Amount credited per booking, for showing "refunded to wallet" on booking lists. */
  async refundsFor(bookingIds: string[]) {
    if (!bookingIds.length) return new Map<string, number>();
    const rows = await this.walletRepo.find({
      where: { bookingId: In(bookingIds), type: 'CREDIT' },
      select: ['bookingId', 'amount'],
    });
    return new Map(rows.map((row) => [row.bookingId as string, Number(row.amount)]));
  }

  private toItem(row: WalletTransaction) {
    return {
      id: row.id,
      type: row.type,
      reason: row.reason,
      amount: Number(row.amount),
      bookingId: row.bookingId,
      bookingNumber: row.booking?.bookingNumber ?? null,
      createdAt: row.createdAt,
    };
  }
}
