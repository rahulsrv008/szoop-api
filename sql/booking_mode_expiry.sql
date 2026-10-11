-- "Right now" vs scheduled bookings, and the 'expired' booking status. Safe to re-run.
-- DispatchService also ensures the column at boot (BOOKING_MODE_SQL in src/dispatch/dispatch.schema.ts).

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';

-- PREPAID, or AFTER_SERVICE when the customer confirmed after a failed online payment.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'PREPAID';

-- bookings.status is VARCHAR(30) with no CHECK constraint, so 'expired' needs no DDL.
