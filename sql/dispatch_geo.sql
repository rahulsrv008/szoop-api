-- H3 geo index for agent ↔ job matching. Safe to re-run.
-- After running, backfill existing rows with: npm run backfill:h3

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS h3_cell VARCHAR(16);
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS current_h3_cell VARCHAR(16);
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS home_h3_cell VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_h3_cell
  ON customer_addresses (h3_cell);
CREATE INDEX IF NOT EXISTS idx_agents_current_h3_cell
  ON agents (current_h3_cell);
CREATE INDEX IF NOT EXISTS idx_agents_home_h3_cell
  ON agents (home_h3_cell);

-- Latest-ping lookups (tracking, admin agent detail).
CREATE INDEX IF NOT EXISTS idx_agent_locations_agent_recorded
  ON agent_locations (agent_id, recorded_at DESC);
