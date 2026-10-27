-- Reminders and no-show steps for jobs an agent holds but hasn't started.
-- Also created at boot by DispatchService (src/dispatch/dispatch.schema.ts).
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

GRANT ALL PRIVILEGES ON TABLE booking_job_alerts TO cladmin;
GRANT ALL PRIVILEGES ON TABLE agent_missed_jobs TO cladmin;
