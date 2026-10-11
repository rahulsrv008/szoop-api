-- Customer wallet ledger: refunds for cancelled/expired bookings are credited here
-- (payments are mocked). Balance = SUM(credits) - SUM(debits). Safe to re-run.
-- WalletService also ensures this at boot (src/common/services/wallet.service.ts).

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

-- A booking is refunded at most once, and its due recorded and cleared at most once.
DROP INDEX IF EXISTS uq_wallet_transactions_refund;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_refund_once
  ON wallet_transactions (booking_id) WHERE reason IN ('BOOKING_CANCELLED', 'BOOKING_EXPIRED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_due_once
  ON wallet_transactions (booking_id, reason) WHERE reason IN ('UNPAID_BOOKING', 'DUE_PAID');
