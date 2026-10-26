-- Agent referrals: every approved agent gets an employee ID (SZ + 2-digit year +
-- 5 random characters) that doubles as their referral code. A code can be used
-- by REFERRAL_MAX_PER_AGENT people, ever. Safe to re-run.
-- ReferralService also ensures this at boot (src/common/referrals/referral.service.ts).

ALTER TABLE agents ADD COLUMN IF NOT EXISTS employee_id VARCHAR(9);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS referred_by_agent_id UUID
  REFERENCES agents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_employee_id ON agents (employee_id);
CREATE INDEX IF NOT EXISTS idx_agents_referred_by ON agents (referred_by_agent_id);

CREATE TABLE IF NOT EXISTS agent_referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  referee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'JOINED',
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- An agent can be referred only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_referrals_referee
  ON agent_referrals (referee_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_referrals_referrer
  ON agent_referrals (referrer_agent_id);

-- One row per reward given or missed when a referee completes the qualifying
-- jobs; missed rows keep the reason. Paid with the monthly salary, whose
-- referral_bonus is the sum of the rewards attached to it.
CREATE TABLE IF NOT EXISTS agent_referral_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  referee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  level INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  intended_amount DECIMAL(10, 2) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  reason_code VARCHAR(30),
  reason_detail JSONB,
  salary_record_id UUID REFERENCES salary_records(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Each reward can be given only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_reward_once
  ON agent_referral_rewards (referee_agent_id, agent_id, type);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_agent_id
  ON agent_referral_rewards (agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_salary_record_id
  ON agent_referral_rewards (salary_record_id);
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS referral_bonus DECIMAL(10, 2) NOT NULL DEFAULT 0;

GRANT ALL PRIVILEGES ON TABLE agent_referrals TO cladmin;
GRANT ALL PRIVILEGES ON TABLE agent_referral_rewards TO cladmin;
