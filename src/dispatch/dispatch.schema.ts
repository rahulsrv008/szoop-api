/**
 * Tables the dispatcher needs, created at boot like the other self-ensuring
 * services (ZoneResolverService, AdminServiceAreasService). Idempotent.
 * Mirrors sql/dispatch_offers.sql and sql/job_alerts.sql, minus the GRANTs (role-specific).
 */
export const DISPATCH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS booking_dispatches (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'searching',
  wave INT NOT NULL DEFAULT 0,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_booking_dispatches_next_action
  ON booking_dispatches (next_action_at);

CREATE TABLE IF NOT EXISTS booking_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  wave INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  distance_km DECIMAL(6, 2),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_offers_booking_agent
  ON booking_offers (booking_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_booking_offers_agent_id
  ON booking_offers (agent_id);

-- One row: when the next request-driven tick may run (hosts without a timer, e.g. Vercel).
CREATE TABLE IF NOT EXISTS dispatch_clock (
  id INT PRIMARY KEY,
  next_tick_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dispatch_clock (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per reminder or no-show step taken for a held job's slot, so each happens once (src/dispatch/held-jobs.service.ts).
CREATE TABLE IF NOT EXISTS booking_job_alerts (
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  slot TIMESTAMPTZ NOT NULL,
  kind VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, agent_id, slot, kind)
);
CREATE INDEX IF NOT EXISTS idx_booking_job_alerts_kind ON booking_job_alerts (kind, slot);

-- Jobs agents held and didn't do, for the admin panel's Missed jobs page (src/database/entities/agent-missed-job.ts).
CREATE TABLE IF NOT EXISTS agent_missed_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reason VARCHAR(30) NOT NULL,
  slot TIMESTAMPTZ NOT NULL,
  details TEXT,
  warned_at TIMESTAMPTZ,
  warned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_missed_jobs_once
  ON agent_missed_jobs (booking_id, agent_id, reason, slot);
CREATE INDEX IF NOT EXISTS idx_agent_missed_jobs_agent
  ON agent_missed_jobs (agent_id, created_at);
`;

/**
 * bookings.booking_mode (sql/booking_mode_expiry.sql). Checked first because
 * ALTER TABLE takes an exclusive lock on bookings even when the column exists,
 * and this runs on every boot.
 */
export const BOOKING_MODE_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'booking_mode'
  ) THEN
    ALTER TABLE bookings ADD COLUMN booking_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'payment_mode'
  ) THEN
    ALTER TABLE bookings ADD COLUMN payment_mode VARCHAR(20) NOT NULL DEFAULT 'PREPAID';
  END IF;
END $$;
`;
