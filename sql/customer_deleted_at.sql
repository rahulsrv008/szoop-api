-- Marks customer accounts that requested deletion. Safe to re-run.
-- After this, a later login on the same number starts a new customer;
-- the old row stays for admin (mobile is freed only when they sign in again).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

UPDATE users
SET deleted_at = COALESCE(deleted_at, updated_at)
WHERE is_active = FALSE
  AND user_type = 'customer'
  AND deleted_at IS NULL
  AND id IN (
    SELECT user_id
    FROM support_tickets
    WHERE subject = 'Szoop account deletion request'
  );
