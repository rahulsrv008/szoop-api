-- Szoop cPanel part 2 of 3. phpPgAdmin: UNCHECK Paginate results, then Execute.

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens(admin_id);

CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    platform VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);

CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value JSONB,
    description TEXT,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('booking_tax_percent', '5'::jsonb, 'GST/tax percentage added to booking subtotal'),
  ('agent_payout_percent', '60'::jsonb, 'Share of booking revenue paid to the agent when no per-service payout is configured'),
  ('agent_fixed_salary', '12000'::jsonb, 'Monthly fixed salary used when generating salary records'),
  ('agent_incentive_threshold', '15000'::jsonb, 'Monthly revenue an agent must generate before incentives apply'),
  ('agent_incentive_percent', '10'::jsonb, 'Incentive percentage on revenue above the threshold'),
  ('booking_cancellation_window_minutes', '60'::jsonb, 'Minutes before start time a customer may cancel free of charge'),
  ('cook_morning_per_person', '1200'::jsonb, 'Cook charge per person for the morning shift, in rupees'),
  ('cook_evening_per_person', '1200'::jsonb, 'Cook charge per person for the evening shift, in rupees'),
  ('cook_both_per_person', '2000'::jsonb, 'Cook charge per person when both morning and evening are booked, in rupees'),
  ('cook_extra_person_discount_percent', '10'::jsonb, 'Percent off the per-person cook rate for each person after the first'),
  ('cook_cleaning_monthly', '1200'::jsonb, 'Flat monthly cleaning add-on on Cook + Cleaning, in rupees')
ON CONFLICT (setting_key) DO NOTHING;

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

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS locality VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(12),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);

CREATE TABLE IF NOT EXISTS agent_bank_accounts (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    account_holder_name VARCHAR(150),
    account_number VARCHAR(100),
    ifsc_code VARCHAR(20),
    bank_name VARCHAR(150),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_bank_accounts_agent_id
  ON agent_bank_accounts(agent_id);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS home_zone UUID REFERENCES service_areas(id) ON DELETE SET NULL;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS service_areas UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS current_location JSONB;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS home_zone UUID REFERENCES service_areas(id) ON DELETE SET NULL;

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS service_area_id UUID REFERENCES service_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_home_zone ON agents (home_zone);

CREATE INDEX IF NOT EXISTS idx_customers_home_zone ON customers (home_zone);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_service_area
  ON customer_addresses (service_area_id);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS boost_enabled BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    code VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(80) NOT NULL,
    training_track VARCHAR(80) NOT NULL,
    description TEXT DEFAULT '',
    match_keywords TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_id UUID NOT NULL REFERENCES skills(id),
    selected BOOLEAN DEFAULT FALSE,
    training_status VARCHAR(30) DEFAULT 'UNVERIFIED',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent_id ON agent_skills(agent_id);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS employee_id VARCHAR(9);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS referred_by_agent_id UUID
  REFERENCES agents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_employee_id ON agents (employee_id);

CREATE INDEX IF NOT EXISTS idx_agents_referred_by ON agents (referred_by_agent_id);

CREATE TABLE IF NOT EXISTS agent_referrals (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  referrer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  referee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'JOINED',
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_referrals_referee
  ON agent_referrals (referee_agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_referrals_referrer
  ON agent_referrals (referrer_agent_id);

missed rows keep the reason. Paid with the monthly salary, whose
CREATE TABLE IF NOT EXISTS agent_referral_rewards (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_reward_once
  ON agent_referral_rewards (referee_agent_id, agent_id, type);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_agent_id
  ON agent_referral_rewards (agent_id);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_salary_record_id
  ON agent_referral_rewards (salary_record_id);

ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS referral_bonus DECIMAL(10, 2) NOT NULL DEFAULT 0;

promote them so they are not locked out.
CREATE TABLE IF NOT EXISTS admin_zones (
  id uuid PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  service_area_id uuid NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_zones_unique UNIQUE (admin_id, service_area_id)
);

CREATE INDEX IF NOT EXISTS admin_zones_admin_idx ON admin_zones (admin_id);

CREATE INDEX IF NOT EXISTS admin_zones_area_idx ON admin_zones (service_area_id);

UPDATE admins
SET role = 'SUPER_ADMIN'
WHERE role = 'ADMIN';

CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name VARCHAR(150) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

new columns are added in place.
ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS code VARCHAR(32);

ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS region VARCHAR(50);

ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS service_radius_km INT DEFAULT 3;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_areas_code
  ON service_areas (code)
  WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_zone_areas (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  service_area_id UUID NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  area_name VARCHAR(150) NOT NULL,
  pincode VARCHAR(10),
  buildings_cover JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_zone_areas_area_id
  ON service_zone_areas (service_area_id);

CREATE INDEX IF NOT EXISTS idx_service_zone_areas_pincode
  ON service_zone_areas (pincode);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'PREPAID';

CREATE TABLE IF NOT EXISTS booking_visits (
  id uuid PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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

ALTER TABLE home_categories
  ADD COLUMN IF NOT EXISTS pricing JSONB NOT NULL DEFAULT '[]';

ALTER TABLE home_category_options
  ADD COLUMN IF NOT EXISTS pricing JSONB NOT NULL DEFAULT '[]';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS plan_title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS home_category_id UUID REFERENCES home_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_option_id UUID REFERENCES home_category_options(id) ON DELETE SET NULL;

UPDATE home_categories
SET title = 'On Demand',
    subtitle = 'An expert, by the hour',
    pricing = '[
      {"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":249},
      {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":299},
      {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":429},
      {"label":"2 hrs","subtitle":null,"minutes":120,"startTime":null,"price":549},
      {"label":"2.5 hrs","subtitle":null,"minutes":150,"startTime":null,"price":679},
      {"label":"3 hrs","subtitle":null,"minutes":180,"startTime":null,"price":799}
    ]'
WHERE id = 'a1a00000-0000-4000-8000-000000000001';

UPDATE home_popular_items
SET title = 'On Demand · 2 hrs', price_label = '₹549'
WHERE id = 'c1c00000-0000-4000-8000-000000000001';
