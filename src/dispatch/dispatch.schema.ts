/**
 * Tables the dispatcher needs, created at boot like the other self-ensuring
 * services (ZoneResolverService, AdminServiceAreasService). Idempotent.
 * Mirrors sql/dispatch_offers.sql, minus the GRANTs (role-specific).
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
`;
