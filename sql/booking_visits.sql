-- One row per scheduled or monthly visit, with its own agent OTP.
CREATE TABLE IF NOT EXISTS booking_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  shift varchar(20) NOT NULL,
  start_time time NOT NULL,
  otp varchar(8) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_visits_booking_id
  ON booking_visits (booking_id, visit_date, start_time);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_visits_slot
  ON booking_visits (booking_id, visit_date, shift);
