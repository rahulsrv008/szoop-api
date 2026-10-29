-- Szoop cPanel Postgres setup
-- phpPgAdmin: UNCHECK "Paginate results", then run each part file in order.
-- Do not paste this whole file into phpPgAdmin in one go.
-- Prefer sql/cpanel_install.php (upload, fill DB details, open in browser, then DELETE).

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(255),
    user_type VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    profile_image TEXT,
    gender VARCHAR(20),
    date_of_birth DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id),
    first_name VARCHAR(100) NOT NULL DEFAULT '',
    last_name VARCHAR(100),
    profile_image TEXT,
    gender VARCHAR(20),
    date_of_birth DATE,
    status VARCHAR(30) DEFAULT 'PENDING',
    approval_status VARCHAR(30) DEFAULT 'PENDING',
    joining_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'ADMIN',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Auth
CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    mobile VARCHAR(15) NOT NULL,
    otp_hash TEXT NOT NULL,
    purpose VARCHAR(30) NOT NULL,
    attempts INT DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_verifications(mobile);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Customer address
CREATE TABLE IF NOT EXISTS customer_addresses (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    customer_id UUID NOT NULL REFERENCES customers(id),
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    landmark TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    address_type VARCHAR(30),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Catalog
CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    category_id UUID REFERENCES service_categories(id),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    duration_minutes INT DEFAULT 60,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_areas (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    name VARCHAR(150) NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    code VARCHAR(32),
    region VARCHAR(50),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    service_radius_km INT DEFAULT 3,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_areas_code ON service_areas (code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_zone_areas (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    service_area_id UUID NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
    area_name VARCHAR(150) NOT NULL,
    pincode VARCHAR(10),
    buildings_cover JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_zone_areas_area_id ON service_zone_areas (service_area_id);
CREATE INDEX IF NOT EXISTS idx_service_zone_areas_pincode ON service_zone_areas (pincode);

CREATE TABLE IF NOT EXISTS service_pricing (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    service_id UUID NOT NULL REFERENCES services(id),
    service_area_id UUID REFERENCES service_areas(id),
    price_per_hour DECIMAL(10,2) NOT NULL,
    agent_payout_per_hour DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS societies (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    name VARCHAR(200) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    total_units INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bookings
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    booking_number VARCHAR(30) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    agent_id UUID REFERENCES agents(id),
    address_id UUID REFERENCES customer_addresses(id),
    service_area_id UUID REFERENCES service_areas(id),
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    duration_minutes INT NOT NULL DEFAULT 60,
    subtotal DECIMAL(10,2) DEFAULT 0,
    discount DECIMAL(10,2) DEFAULT 0,
    tax DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) DEFAULT 0,
    payment_status VARCHAR(30) DEFAULT 'PENDING',
    status VARCHAR(30) DEFAULT 'finding',
    start_otp VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_items (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    service_id UUID NOT NULL REFERENCES services(id),
    quantity INT DEFAULT 1,
    duration_minutes INT,
    price_per_hour DECIMAL(10,2),
    amount DECIMAL(10,2)
);

CREATE TABLE IF NOT EXISTS booking_status_history (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    status VARCHAR(30) NOT NULL,
    changed_by UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Agent ops
CREATE TABLE IF NOT EXISTS agent_availability (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    availability_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_locations (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    booking_id UUID REFERENCES bookings(id),
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_attendance (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    attendance_date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_documents (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    document_url TEXT,
    verification_status VARCHAR(30) DEFAULT 'PENDING',
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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

-- 7. Payments + earnings
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(30),
    payment_status VARCHAR(30) DEFAULT 'PENDING',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    payment_id UUID NOT NULL REFERENCES payments(id),
    gateway_name VARCHAR(50),
    gateway_transaction_id VARCHAR(150),
    gateway_response JSONB,
    status VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_earnings (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    booking_id UUID REFERENCES bookings(id),
    service_hours DECIMAL(8,2) DEFAULT 0,
    revenue_generated DECIMAL(10,2) DEFAULT 0,
    earning_amount DECIMAL(10,2) DEFAULT 0,
    earning_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_incentives (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    month INT NOT NULL,
    year INT NOT NULL,
    revenue_generated DECIMAL(10,2) DEFAULT 0,
    threshold_amount DECIMAL(10,2) DEFAULT 15000,
    incentive_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_records (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    agent_id UUID NOT NULL REFERENCES agents(id),
    month INT NOT NULL,
    year INT NOT NULL,
    fixed_salary DECIMAL(10,2) DEFAULT 12000,
    incentive DECIMAL(10,2) DEFAULT 0,
    deductions DECIMAL(10,2) DEFAULT 0,
    net_salary DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. Ratings, notifications, support
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    rating DECIMAL(2,1) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    rating_id UUID NOT NULL REFERENCES ratings(id),
    review_text TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(200),
    message TEXT,
    notification_type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID NOT NULL REFERENCES users(id),
    booking_id UUID REFERENCES bookings(id),
    subject VARCHAR(200),
    description TEXT,
    priority VARCHAR(30) DEFAULT 'NORMAL',
    status VARCHAR(30) DEFAULT 'OPEN',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Coupons + audit
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_type VARCHAR(20) NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    max_discount DECIMAL(10,2),
    min_order_amount DECIMAL(10,2),
    usage_limit INT,
    used_count INT DEFAULT 0,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_usage (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    coupon_id UUID NOT NULL REFERENCES coupons(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id),
    discount_amount DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_agent_id ON bookings(agent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_agent_locations_agent_id ON agent_locations(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_locations_booking_id ON agent_locations(booking_id);
CREATE INDEX IF NOT EXISTS idx_agent_earnings_agent_id ON agent_earnings(agent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);


-- =============================================================================
-- 002_auth_devices_settings.sql
-- =============================================================================

-- 002: additions needed by the three-app API layer.
--  * refresh_tokens can now belong to an admin (admins live outside `users`)
--  * device_tokens stores FCM registration ids for push
--  * system_settings backs Admin Web → Settings
-- Safe to re-run.

-- 1. Refresh tokens for admin sessions
ALTER TABLE refresh_tokens ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id);


CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens(admin_id);

-- 2. Push device tokens
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

-- 3. Editable system settings
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


-- =============================================================================
-- customer_deleted_at.sql
-- =============================================================================

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


-- =============================================================================
-- agent_address.sql
-- =============================================================================

-- Live address captured from the agent map, plus optional passbook scans.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS locality VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(12),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);


-- =============================================================================
-- agent_bank_accounts.sql
-- =============================================================================

-- Payout bank account saved from agent onboarding.
-- Safe to run on an existing ClearIt database.

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

-- =============================================================================
-- agent_customer_zones.sql
-- =============================================================================

-- Agent coverage + customer zone assignment. Safe to re-run.

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


-- =============================================================================
-- agent_skills_boost.sql
-- =============================================================================

-- Incremental: skills catalog, agent skill selections, booking boost.
-- Safe to run on an existing ClearIt database.

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

-- =============================================================================
-- agent_referrals.sql
-- =============================================================================

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
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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
-- Each reward can be given only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_reward_once
  ON agent_referral_rewards (referee_agent_id, agent_id, type);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_agent_id
  ON agent_referral_rewards (agent_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_salary_record_id
  ON agent_referral_rewards (salary_record_id);
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS referral_bonus DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- =============================================================================
-- admin_zones.sql
-- =============================================================================

-- Zone assignments for Admin Web users.
-- SUPER_ADMIN sees every zone. Every other role sees only the zones listed here.
-- Existing full-access admins were stored as ADMIN; promote them so they are not locked out.

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


-- =============================================================================
-- service_zones.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name VARCHAR(150) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Existing installs keep their rows; new columns are added in place.
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


-- =============================================================================
-- booking_mode_expiry.sql
-- =============================================================================

-- "Right now" vs scheduled bookings, and the 'expired' booking status. Safe to re-run.
-- DispatchService also ensures the column at boot (BOOKING_MODE_SQL in src/dispatch/dispatch.schema.ts).

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';

-- PREPAID, or AFTER_SERVICE when the customer confirmed after a failed online payment.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'PREPAID';

-- bookings.status is VARCHAR(30) with no CHECK constraint, so 'expired' needs no DDL.


-- =============================================================================
-- booking_visits.sql
-- =============================================================================

-- One row per scheduled or monthly visit, with its own agent OTP.
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


-- =============================================================================
-- plan_bookings.sql
-- =============================================================================

-- On Demand durations + monthly plan shifts, and plan bookings. Safe to re-run.

ALTER TABLE home_categories
  ADD COLUMN IF NOT EXISTS pricing JSONB NOT NULL DEFAULT '[]';

ALTER TABLE home_category_options
  ADD COLUMN IF NOT EXISTS pricing JSONB NOT NULL DEFAULT '[]';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS plan_title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS home_category_id UUID REFERENCES home_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_option_id UUID REFERENCES home_category_options(id) ON DELETE SET NULL;

-- Rename Hourly Help -> On Demand and give it durations (45 min – 3 hrs).
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

-- Monthly plan shifts: Morning / Evening / Both.
UPDATE home_category_options SET pricing = '[
  {"label":"Morning","subtitle":"7 AM – 11 AM","minutes":240,"startTime":"07:00","price":4999},
  {"label":"Evening","subtitle":"5 PM – 9 PM","minutes":240,"startTime":"17:00","price":4999},
  {"label":"Both","subtitle":"Morning + Evening","minutes":480,"startTime":"07:00","price":8999}
]' WHERE id = 'b1b00000-0000-4000-8000-000000000001';

UPDATE home_category_options SET pricing = '[
  {"label":"Morning","subtitle":"7 AM – 11 AM","minutes":240,"startTime":"07:00","price":3999},
  {"label":"Evening","subtitle":"5 PM – 9 PM","minutes":240,"startTime":"17:00","price":3999},
  {"label":"Both","subtitle":"Morning + Evening","minutes":480,"startTime":"07:00","price":6999}
]' WHERE id = 'b1b00000-0000-4000-8000-000000000002';

UPDATE home_category_options SET pricing = '[
  {"label":"Morning","subtitle":"7 AM – 11 AM","minutes":240,"startTime":"07:00","price":7999},
  {"label":"Evening","subtitle":"5 PM – 9 PM","minutes":240,"startTime":"17:00","price":7999},
  {"label":"Both","subtitle":"Morning + Evening","minutes":480,"startTime":"07:00","price":13999}
]' WHERE id = 'b1b00000-0000-4000-8000-000000000003';


-- =============================================================================
-- customer_wallet.sql
-- =============================================================================

-- Customer wallet ledger: refunds for cancelled/expired bookings are credited here
-- (payments are mocked). Balance = SUM(credits) - SUM(debits). Safe to re-run.
-- WalletService also ensures this at boot (src/common/services/wallet.service.ts).

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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


-- =============================================================================
-- coupon_eligibility_rules.sql
-- =============================================================================

-- Coupon Eligibility Rules table and Coupons linkage
CREATE TABLE IF NOT EXISTS coupon_eligibility_rules (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name VARCHAR(150) NOT NULL,
  description VARCHAR(255),
  applicable_services TEXT[] NOT NULL DEFAULT '{"ALL"}',
  match_type VARCHAR(10) NOT NULL DEFAULT 'AND',
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS eligibility_rule_id UUID REFERENCES coupon_eligibility_rules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_eligibility_rule_id ON coupons(eligibility_rule_id);


-- =============================================================================
-- dispatch_geo.sql
-- =============================================================================

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


-- =============================================================================
-- dispatch_offers.sql
-- =============================================================================

-- Push dispatch: offers sent to agents in widening waves. Safe to re-run.
-- Run after sql/dispatch_geo.sql.

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
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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

-- =============================================================================
-- job_alerts.sql
-- =============================================================================

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
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
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

-- =============================================================================
-- notification_app.sql
-- =============================================================================

-- Which app a registered phone, notification or support ticket belongs to
-- ('customer' | 'agent'). One user (one mobile) can be both a customer and an
-- agent, so pushes and notification lists are kept per app. Null: older rows
-- (shown in both apps; phones get tagged when their app registers again).
-- NotificationDispatchService also ensures these at boot. Safe to re-run.

ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS app VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS app VARCHAR(20);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS app VARCHAR(20);


-- =============================================================================
-- upcoming_cities.sql
-- =============================================================================

-- "Coming soon" cities and the customers waiting on them.
-- Safe to re-run. Also ensured at boot by ServiceabilityService, which seeds
-- the rows from src/database/seeds/upcoming-cities.data.ts.

CREATE TABLE IF NOT EXISTS upcoming_cities (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  city VARCHAR(100) NOT NULL UNIQUE,
  nickname VARCHAR(100),
  state VARCHAR(100),
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_km INT NOT NULL DEFAULT 25,
  message TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS city_waitlist (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  city_key VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  upcoming_city_id UUID REFERENCES upcoming_cities(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_city_waitlist_customer_city UNIQUE (customer_id, city_key)
);

CREATE INDEX IF NOT EXISTS idx_city_waitlist_city_key ON city_waitlist (city_key);


-- =============================================================================
-- home_content.sql
-- =============================================================================

-- Customer app home: admin-managed category tiles, their options, and "Most popular" cards.
-- Safe to re-run: tables use IF NOT EXISTS and seed rows use fixed ids with ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS home_categories (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  title VARCHAR(100) NOT NULL,
  subtitle VARCHAR(200),
  badge VARCHAR(40),
  image_url TEXT,
  tile_color VARCHAR(20),
  layout VARCHAR(10) NOT NULL DEFAULT 'HALF',
  action_type VARCHAR(20) NOT NULL DEFAULT 'POPUP',
  popup_title VARCHAR(120),
  highlights JSONB NOT NULL DEFAULT '[]',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS home_category_options (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  category_id UUID NOT NULL REFERENCES home_categories(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  subtitle VARCHAR(200),
  price_label VARCHAR(60),
  badge VARCHAR(40),
  image_url TEXT,
  popup_title VARCHAR(120),
  highlights JSONB NOT NULL DEFAULT '[]',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_home_category_options_category_id
  ON home_category_options(category_id);

CREATE TABLE IF NOT EXISTS home_popular_items (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  title VARCHAR(120) NOT NULL,
  subtitle VARCHAR(200),
  image_url TEXT,
  price_label VARCHAR(60),
  badge VARCHAR(40),
  rating DECIMAL(2, 1),
  category_id UUID REFERENCES home_categories(id) ON DELETE SET NULL,
  option_id UUID REFERENCES home_category_options(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed ------------------------------------------------------------------------

INSERT INTO home_categories
  (id, title, subtitle, badge, tile_color, layout, action_type, popup_title, highlights, sort_order)
VALUES
  ('a1a00000-0000-4000-8000-000000000001', 'Hourly Help', 'Book an expert by the hour', NULL,
   '#EDE4F5', 'HALF', 'POPUP', 'What our expert will do',
   '[{"text":"Sweeping & mopping of all rooms","icon":"home"},
     {"text":"Kitchen counters, sink & stove wipe-down","icon":"restaurant"},
     {"text":"Bathroom scrub & disinfect","icon":"water"},
     {"text":"Dusting furniture, fans & shelves","icon":"sparkles"},
     {"text":"Laundry folding & bed making","icon":"shirt"}]', 1),
  ('a1a00000-0000-4000-8000-000000000002', 'Monthly Pass', 'Same expert, every day', 'SAVE 20%',
   '#F3C4CE', 'HALF', 'OPTIONS', NULL, '[]', 2),
  ('a1a00000-0000-4000-8000-000000000003', 'Salon at Home', 'Salon & spa by verified beauty experts', 'PREMIUM',
   '#F3E8FF', 'HALF', 'OPTIONS', 'Salon & Spa at Home',
   '[{"text":"100% mess-free single-use hygienic kits","icon":"shield-checkmark"},
     {"text":"Top-rated, certified women beauty experts","icon":"star"},
     {"text":"Premium salon products (L''Oreal, Cheryl''s, O3+)","icon":"sparkles"},
     {"text":"Complete post-service cleanup & sanitisation","icon":"checkmark-circle"}]', 3)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  badge = EXCLUDED.badge,
  tile_color = EXCLUDED.tile_color,
  layout = EXCLUDED.layout,
  action_type = EXCLUDED.action_type,
  popup_title = EXCLUDED.popup_title,
  highlights = EXCLUDED.highlights;

INSERT INTO home_category_options
  (id, category_id, title, subtitle, price_label, badge, popup_title, highlights, pricing, sort_order)
VALUES
  ('b1b00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000002',
   'Healthy Cook', 'Healthy home-style & diet meals, every day', '₹4,999 / month', 'HEALTHY', 'What your cook will do',
   '[{"text":"Healthy, balanced home-style meals","icon":"leaf"},
     {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
     {"text":"Plans a weekly menu with you","icon":"calendar"},
     {"text":"Cooks 2 fresh meals a day","icon":"restaurant"},
     {"text":"Chops, preps & stores groceries","icon":"basket"},
     {"text":"Cleans the kitchen after cooking","icon":"sparkles"},
     {"text":"Hygiene-checked & verified cook","icon":"shield-checkmark"}]', '[]', 1),
  ('b1b00000-0000-4000-8000-000000000002', 'a1a00000-0000-4000-8000-000000000002',
   'House Cleaning', 'A spotless home, daily', '₹3,999 / month', NULL, 'What your expert will do',
   '[{"text":"Daily sweeping & mopping","icon":"home"},
     {"text":"Dishes & kitchen cleanup","icon":"water"},
     {"text":"Bathroom cleaning twice a week","icon":"sparkles"},
     {"text":"Dusting & tidying every room","icon":"leaf"},
     {"text":"Same trusted expert every day","icon":"person"}]', '[]', 2),
  ('b1b00000-0000-4000-8000-000000000003', 'a1a00000-0000-4000-8000-000000000002',
   'Cook + Cleaning', 'Both, bundled & cheaper', '₹7,999 / month', 'BEST VALUE', 'Everything in one pass',
   '[{"text":"Healthy, balanced home-style meals","icon":"leaf"},
     {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
     {"text":"Everything in Healthy Cook","icon":"restaurant"},
     {"text":"Everything in House Cleaning","icon":"home"},
     {"text":"Dedicated, verified experts","icon":"people"},
     {"text":"Free replacement when on leave","icon":"swap-horizontal"},
     {"text":"Priority support","icon":"star"}]', '[]', 3),
  ('b3b00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000003',
   'Quick Grooming', 'Brows, upper lip, chin & face cleanup', 'from ₹199', 'POPULAR', 'What your beauty expert will do',
   '[{"text":"Eyebrow, upper lip & chin threading","icon":"sparkles"},
     {"text":"Gentle face cleanup & organic detan pack","icon":"leaf"},
     {"text":"Single-use disposable hygienic kit","icon":"shield-checkmark"},
     {"text":"Post-service soothing face aloe gel","icon":"water"}]',
   '[{"label":"Express (30m)","subtitle":"Eyebrow + Upper Lip","minutes":30,"startTime":null,"price":199},
     {"label":"Standard (45m)","subtitle":"Threading + Cleanup","minutes":45,"startTime":null,"price":299},
     {"label":"Glow (60m)","subtitle":"Threading + Detan Cleanup","minutes":60,"startTime":null,"price":449}]', 1),
  ('b3b00000-0000-4000-8000-000000000002', 'a1a00000-0000-4000-8000-000000000003',
   'Waxing & Detan', 'Arms, legs & underarms smooth waxing', 'from ₹299', 'BESTSELLER', 'What your beauty expert will do',
   '[{"text":"Full arms & full legs smooth waxing","icon":"leaf"},
     {"text":"Underarm waxing with soothing gel","icon":"water"},
     {"text":"Gentle honey & chocolate wax options","icon":"sparkles"},
     {"text":"Disposable bedsheet & sanitised kit","icon":"shield-checkmark"}]',
   '[{"label":"Arms & Underarms (35m)","subtitle":null,"minutes":35,"startTime":null,"price":299},
     {"label":"Full Arms + Legs (60m)","subtitle":null,"minutes":60,"startTime":null,"price":599},
     {"label":"Full Body & Detan (90m)","subtitle":"Complete wax + detan pack","minutes":90,"startTime":null,"price":899}]', 2),
  ('b3b00000-0000-4000-8000-000000000003', 'a1a00000-0000-4000-8000-000000000003',
   'Facial & Cleanup', 'Deep cleansing, exfoliation & gold glow', 'from ₹399', 'TRENDING', 'What your beauty expert will do',
   '[{"text":"Steam, blackhead removal & gentle scrub","icon":"water"},
     {"text":"15-min relaxing face & neck massage","icon":"sparkles"},
     {"text":"Skin brightening detan mask","icon":"sunny"},
     {"text":"Cheryl''s & O3+ certified skin packs","icon":"star"}]',
   '[{"label":"Basic Cleanup (40m)","subtitle":"Cleanse + steam + scrub","minutes":40,"startTime":null,"price":399},
     {"label":"Fruit Glow Facial (55m)","subtitle":"Antioxidant fruit pack","minutes":55,"startTime":null,"price":599},
     {"label":"Gold Radiance Facial (75m)","subtitle":"Complete luxury glow treatment","minutes":75,"startTime":null,"price":799}]', 3),
  ('b3b00000-0000-4000-8000-000000000004', 'a1a00000-0000-4000-8000-000000000003',
   'Hair Spa & Care', 'Haircut, nourishing spa & head massage', 'from ₹249', NULL, 'What your beauty expert will do',
   '[{"text":"Warm oil scalp massage & pressure points","icon":"heart"},
     {"text":"Deep conditioning hair spa & steam treatment","icon":"water"},
     {"text":"Professional haircut & split-ends trim","icon":"cut"},
     {"text":"Leave-in serum & blow-dry styling","icon":"sparkles"}]',
   '[{"label":"Haircut & Styling (30m)","subtitle":null,"minutes":30,"startTime":null,"price":249},
     {"label":"Scalp Massage & Steam (35m)","subtitle":null,"minutes":35,"startTime":null,"price":349},
     {"label":"L''Oreal Hair Spa (60m)","subtitle":"Spa cream bath + steam + blow-dry","minutes":60,"startTime":null,"price":899}]', 4),
  ('b3b00000-0000-4000-8000-000000000005', 'a1a00000-0000-4000-8000-000000000003',
   'Manicure & Pedicure', 'Rose soak, exfoliating scrub & massage', 'from ₹349', NULL, 'What your beauty expert will do',
   '[{"text":"Warm bubble soak & gentle cuticle care","icon":"water"},
     {"text":"Dead skin removal & exfoliating scrub","icon":"sparkles"},
     {"text":"Relaxing reflexology cream massage","icon":"heart"},
     {"text":"Nail buffing, shaping & premium polish","icon":"color-palette"}]',
   '[{"label":"Classic Manicure (30m)","subtitle":null,"minutes":30,"startTime":null,"price":349},
     {"label":"Classic Pedicure (40m)","subtitle":null,"minutes":40,"startTime":null,"price":399},
     {"label":"Deluxe Mani + Pedi Combo (75m)","subtitle":"Complete pamper session","minutes":75,"startTime":null,"price":699}]', 5),
  ('b3b00000-0000-4000-8000-000000000006', 'a1a00000-0000-4000-8000-000000000003',
   'Party & Wedding Glam', 'Professional makeup, saree drape & hair', 'from ₹999', 'BEST VALUE', 'What your beauty expert will do',
   '[{"text":"Flawless HD party or bridal makeup","icon":"sparkles"},
     {"text":"Hairstyling (curls, buns, braids, blow-dry)","icon":"cut"},
     {"text":"Saree / dupatta draping & pin-up","icon":"shirt"},
     {"text":"Eyelashes & touch-up kit included","icon":"star"}]',
   '[{"label":"Party Makeup & Hair (60m)","subtitle":"HD makeup + hairstyle","minutes":60,"startTime":null,"price":999},
     {"label":"Engagement Glam (90m)","subtitle":"Full glam + draping","minutes":90,"startTime":null,"price":1999},
     {"label":"Bridal Makeup (150m)","subtitle":"Luxury bridal HD glam","minutes":150,"startTime":null,"price":3499}]', 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO home_popular_items
  (id, title, subtitle, price_label, badge, rating, category_id, option_id, sort_order)
VALUES
  ('c1c00000-0000-4000-8000-000000000001', 'Hourly Help · 2 hrs', 'Quick clean-up by a verified expert',
   '₹398', 'TRENDING', 4.8, 'a1a00000-0000-4000-8000-000000000001', NULL, 1),
  ('c1c00000-0000-4000-8000-000000000002', 'Healthy Cook Pass', 'Healthy home-style & diet meals, every day',
   '₹4,999 / mo', 'HEALTHY', 4.7, 'a1a00000-0000-4000-8000-000000000002', 'b1b00000-0000-4000-8000-000000000001', 2),
  ('c1c00000-0000-4000-8000-000000000003', 'Cook + Cleaning Pass', 'Our best-value monthly plan',
   '₹7,999 / mo', 'BEST VALUE', 4.9, 'a1a00000-0000-4000-8000-000000000002', 'b1b00000-0000-4000-8000-000000000003', 3),
  ('c1c00000-0000-4000-8000-000000000004', 'Waxing & Detan · Full Body', 'Smooth waxing with soothing post-wax gel',
   '₹899', 'POPULAR', 4.9, 'a1a00000-0000-4000-8000-000000000003', 'b3b00000-0000-4000-8000-000000000002', 4)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- cook_per_person.sql
-- =============================================================================

-- Cook is charged per person. The first person pays the full rate.
-- Each extra person gets the configured percent off that rate.
-- Change the numbers from Admin → Settings.

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('cook_per_person_price', '1700'::jsonb, 'Monthly cook charge per person, in rupees'),
  ('cook_extra_person_discount_percent', '10'::jsonb, 'Percent off the per-person cook rate for each person after the first')
ON CONFLICT (setting_key) DO NOTHING;

UPDATE home_category_options
SET price_label = 'from ₹1,700 / person'
WHERE id = 'b1b00000-0000-4000-8000-000000000001';

UPDATE home_popular_items
SET price_label = 'from ₹1,700 / person'
WHERE id = 'c1c00000-0000-4000-8000-000000000002';


-- =============================================================================
-- cook_shift_pricing.sql
-- =============================================================================

-- Cook rates by shift, extra-person discount, and the Cook + Cleaning add-on.
-- Customers are charged from these settings (Admin → Settings).

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('cook_morning_per_person', '1200'::jsonb, 'Cook charge per person for the morning shift, in rupees'),
  ('cook_evening_per_person', '1200'::jsonb, 'Cook charge per person for the evening shift, in rupees'),
  ('cook_both_per_person', '2000'::jsonb, 'Cook charge per person when both morning and evening are booked, in rupees'),
  ('cook_extra_person_discount_percent', '10'::jsonb, 'Percent off the per-person cook rate for each person after the first'),
  ('cook_cleaning_monthly', '1200'::jsonb, 'Flat monthly cleaning add-on on Cook + Cleaning, in rupees')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description;

DELETE FROM system_settings WHERE setting_key = 'cook_per_person_price';

UPDATE home_category_options
SET price_label = 'from ₹1,200 / person',
    pricing = '[
      {"label":"Morning","subtitle":"7 AM – 11 AM","minutes":240,"startTime":"07:00","price":1200},
      {"label":"Evening","subtitle":"5 PM – 9 PM","minutes":240,"startTime":"17:00","price":1200},
      {"label":"Both","subtitle":"Morning + Evening","minutes":480,"startTime":"07:00","price":2000}
    ]'::jsonb
WHERE id = 'b1b00000-0000-4000-8000-000000000001';

UPDATE home_category_options
SET price_label = 'Cook from ₹1,200 / person + ₹1,200 cleaning',
    pricing = '[
      {"label":"Morning","subtitle":"7 AM – 11 AM","minutes":240,"startTime":"07:00","price":1200},
      {"label":"Evening","subtitle":"5 PM – 9 PM","minutes":240,"startTime":"17:00","price":1200},
      {"label":"Both","subtitle":"Morning + Evening","minutes":480,"startTime":"07:00","price":2000}
    ]'::jsonb
WHERE id = 'b1b00000-0000-4000-8000-000000000003';

UPDATE home_popular_items
SET price_label = 'from ₹1,200 / person'
WHERE id = 'c1c00000-0000-4000-8000-000000000002';

UPDATE home_popular_items
SET price_label = 'Cook + ₹1,200 cleaning'
WHERE id = 'c1c00000-0000-4000-8000-000000000003';


-- =============================================================================
-- cook_plan_pricing.sql
-- =============================================================================

-- Morning / Evening / Both shifts for cook plans. Safe to re-run.

UPDATE home_category_options
SET
  pricing = '[
    {"label":"Morning","subtitle":"6 AM – 11 AM","minutes":45,"startTime":"08:00","price":1200},
    {"label":"Evening","subtitle":"4:45 PM – 9:45 PM","minutes":45,"startTime":"16:45","price":1200},
    {"label":"Both","subtitle":"Morning & evening","minutes":45,"startTime":"08:00","price":2000}
  ]'::jsonb,
  updated_at = NOW()
WHERE id IN (
  'b1b00000-0000-4000-8000-000000000001',
  'b1b00000-0000-4000-8000-000000000003'
)
AND (pricing IS NULL OR pricing = '[]'::jsonb OR jsonb_array_length(pricing) = 0);


-- =============================================================================
-- cook_healthy_highlights.sql
-- =============================================================================

-- Add healthy + diet meal-prep highlights to cook plans. Safe to re-run.

UPDATE home_category_options
SET
  subtitle = 'Healthy home-style & diet meals, every day',
  badge = 'HEALTHY',
  popup_title = 'What your cook will do',
  highlights = '[
    {"text":"Healthy, balanced home-style meals","icon":"leaf"},
    {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
    {"text":"Plans a weekly menu with you","icon":"calendar"},
    {"text":"Cooks 2 fresh meals a day","icon":"restaurant"},
    {"text":"Chops, preps & stores groceries","icon":"basket"},
    {"text":"Cleans the kitchen after cooking","icon":"sparkles"},
    {"text":"Hygiene-checked & verified cook","icon":"shield-checkmark"}
  ]'::jsonb,
  updated_at = NOW()
WHERE id = 'b1b00000-0000-4000-8000-000000000001';

UPDATE home_category_options
SET
  subtitle = 'Healthy meals plus a spotless home',
  highlights = '[
    {"text":"Healthy, balanced home-style meals","icon":"leaf"},
    {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
    {"text":"Everything in Healthy Cook","icon":"restaurant"},
    {"text":"Everything in House Cleaning","icon":"home"},
    {"text":"Dedicated, verified experts","icon":"people"},
    {"text":"Free replacement when on leave","icon":"swap-horizontal"},
    {"text":"Priority support","icon":"star"}
  ]'::jsonb,
  updated_at = NOW()
WHERE id = 'b1b00000-0000-4000-8000-000000000003';

UPDATE home_category_options
SET title = 'Healthy Cook', updated_at = NOW()
WHERE title = 'Smart Cook';

UPDATE home_category_options
SET highlights = REPLACE(highlights::text, 'Smart Cook', 'Healthy Cook')::jsonb,
    updated_at = NOW()
WHERE highlights::text LIKE '%Smart Cook%';

UPDATE home_popular_items
SET
  title = REPLACE(title, 'Smart Cook', 'Healthy Cook'),
  subtitle = 'Healthy home-style & diet meals, every day',
  badge = 'HEALTHY',
  updated_at = NOW()
WHERE id = 'c1c00000-0000-4000-8000-000000000002'
   OR title LIKE '%Smart Cook%';


-- =============================================================================
-- bathroom_cleaning.sql
-- =============================================================================

-- Bathroom Cleaning becomes its own home category, bathrooms are left out of Home Cleaning
-- (shown to customers as an exclusion), and the Bathroom Cleaning skill that bathroom jobs
-- now require is added. Text is only rewritten while it still matches the original seed,
-- so admin edits are kept. Safe to re-run.

-- What a service doesn't cover (the API also adds these columns at boot).
ALTER TABLE home_categories ADD COLUMN IF NOT EXISTS exclusions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE home_category_options ADD COLUMN IF NOT EXISTS exclusions JSONB NOT NULL DEFAULT '[]';

-- 1. Bathroom Cleaning category, listed right after Express Service.
INSERT INTO home_categories
  (id, title, subtitle, badge, tile_color, layout, action_type, popup_title, highlights, sort_order)
VALUES
  ('a1a00000-0000-4000-8000-000000000004', 'Bathroom Cleaning', 'Toilets, tiles & fittings, deep cleaned',
   NULL, '#F6EEDC', 'HALF', 'OPTIONS', NULL, '[]', 1)
ON CONFLICT (id) DO NOTHING;

-- The Bathroom Deep Clean option moves under it (same id, so existing bookings and links keep working).
UPDATE home_category_options
SET category_id = 'a1a00000-0000-4000-8000-000000000004',
    updated_at = NOW()
WHERE id = 'b2b00000-0000-4000-8000-000000000003'
  AND category_id <> 'a1a00000-0000-4000-8000-000000000004';

-- Express Service is general help that any partner can take, so it no longer promises bathrooms.
UPDATE home_categories
SET highlights = COALESCE(
      (SELECT jsonb_agg(item ORDER BY position)
         FROM jsonb_array_elements(highlights) WITH ORDINALITY AS list(item, position)
        WHERE item->>'text' <> 'Bathroom scrub & disinfect'),
      '[]'::jsonb),
    updated_at = NOW()
WHERE id = 'a1a00000-0000-4000-8000-000000000001'
  AND highlights @> '[{"text":"Bathroom scrub & disinfect"}]';

-- 2. Home Cleaning leaves out bathrooms and washrooms.
UPDATE home_category_options
SET subtitle = 'Sweep, mop & dust every room except bathrooms',
    updated_at = NOW()
WHERE (id = 'b2b00000-0000-4000-8000-000000000001' OR title ILIKE 'home cleaning')
  AND subtitle = 'Sweep, mop & dust every room';

UPDATE home_category_options
SET highlights = (
      SELECT jsonb_agg(
               CASE WHEN item->>'text' = 'Sweeping & mopping of all rooms'
                    THEN jsonb_set(item, '{text}', '"Sweeping & mopping of all rooms except bathrooms"')
                    ELSE item END
               ORDER BY position)
        FROM jsonb_array_elements(highlights) WITH ORDINALITY AS list(item, position)),
    updated_at = NOW()
WHERE (id = 'b2b00000-0000-4000-8000-000000000001' OR title ILIKE 'home cleaning')
  AND highlights @> '[{"text":"Sweeping & mopping of all rooms"}]';

UPDATE home_category_options
SET exclusions = '["Bathrooms and washrooms"]',
    updated_at = NOW()
WHERE (id = 'b2b00000-0000-4000-8000-000000000001' OR title ILIKE 'home cleaning')
  AND exclusions = '[]'::jsonb;

-- 3. Only partners with this skill are offered or assigned bathroom jobs.
INSERT INTO skills (code, name, category, training_track, description, match_keywords)
VALUES ('bathroom_cleaning', 'Bathroom Cleaning', 'Home', 'Cleaning',
        'Toilets, tiles, fittings and disinfection', 'bathroom,washroom,toilet')
ON CONFLICT (code) DO NOTHING;

UPDATE skills
SET description = 'Sweeping, mopping and dusting (bathrooms are a separate skill)',
    match_keywords = 'home cleaning,cleaning,maid,mop,dust',
    updated_at = NOW()
WHERE code = 'home_cleaning'
  AND match_keywords = 'home cleaning,cleaning,maid,mop,dust,bathroom';


-- =============================================================================
-- on_demand_services.sql
-- =============================================================================

-- Express Service sub-services shown on the customer home. Safe to re-run.

UPDATE home_categories
SET action_type = 'OPTIONS',
    title = 'Express Service',
    subtitle = 'Expert at your door in 15 min'
WHERE id = 'a1a00000-0000-4000-8000-000000000001';

INSERT INTO home_category_options
  (id, category_id, title, subtitle, price_label, badge, popup_title, highlights, pricing, sort_order, is_active)
VALUES
  ('b2b00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000001',
   'Home Cleaning', 'Sweep, mop & dust every room', 'from ₹249', 'BESTSELLER',
   'What your expert will do',
   '[{"text":"Sweeping & mopping of all rooms","icon":"home"},
     {"text":"Dusting furniture, fans & shelves","icon":"sparkles"},
     {"text":"Kitchen counter & sink wipe-down","icon":"restaurant"},
     {"text":"Trash cleared and bins relined","icon":"trash"}]',
   '[{"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":249},
     {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":299},
     {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":429},
     {"label":"2 hrs","subtitle":null,"minutes":120,"startTime":null,"price":549},
     {"label":"2.5 hrs","subtitle":null,"minutes":150,"startTime":null,"price":679},
     {"label":"3 hrs","subtitle":null,"minutes":180,"startTime":null,"price":799}]',
   1, true),
  ('b2b00000-0000-4000-8000-000000000002', 'a1a00000-0000-4000-8000-000000000001',
   'Kitchen & Dishes', 'Utensils, slab, stove & sink', 'from ₹249', NULL,
   'What your expert will do',
   '[{"text":"Wash and dry all utensils","icon":"water"},
     {"text":"Stove, slab & chimney wipe-down","icon":"flame"},
     {"text":"Sink scrub and drain clean","icon":"sparkles"},
     {"text":"Fridge outside & shelves wiped","icon":"snow"}]',
   '[{"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":249},
     {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":299},
     {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":429},
     {"label":"2 hrs","subtitle":null,"minutes":120,"startTime":null,"price":549}]',
   2, true),
  ('b2b00000-0000-4000-8000-000000000003', 'a1a00000-0000-4000-8000-000000000001',
   'Bathroom Deep Clean', 'Tiles, fittings & disinfection', 'from ₹299', 'TRENDING',
   'What your expert will do',
   '[{"text":"Tile & grout scrubbing","icon":"grid"},
     {"text":"Toilet, basin & shower disinfected","icon":"medkit"},
     {"text":"Taps and mirrors polished","icon":"sparkles"},
     {"text":"Floor dried and deodorised","icon":"leaf"}]',
   '[{"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":299},
     {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":349},
     {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":499}]',
   3, true),
  ('b2b00000-0000-4000-8000-000000000004', 'a1a00000-0000-4000-8000-000000000001',
   'Laundry & Ironing', 'Wash, dry, fold & press', 'from ₹249', NULL,
   'What your expert will do',
   '[{"text":"Machine or hand wash clothes","icon":"water"},
     {"text":"Drying and neat folding","icon":"shirt"},
     {"text":"Ironing & pressing","icon":"flash"},
     {"text":"Wardrobe arranged","icon":"file-tray-stacked"}]',
   '[{"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":249},
     {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":299},
     {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":429}]',
   4, true),
  ('b2b00000-0000-4000-8000-000000000005', 'a1a00000-0000-4000-8000-000000000001',
   'Dusting & Organising', 'Shelves, fans, wardrobes', 'from ₹249', NULL,
   'What your expert will do',
   '[{"text":"Fans, lights & switchboards dusted","icon":"bulb"},
     {"text":"Shelves and showcases cleaned","icon":"library"},
     {"text":"Wardrobe & drawers organised","icon":"file-tray-full"},
     {"text":"Sofa & bed vacuum-dusted","icon":"bed"}]',
   '[{"label":"45 min","subtitle":null,"minutes":45,"startTime":null,"price":249},
     {"label":"1 hr","subtitle":null,"minutes":60,"startTime":null,"price":299},
     {"label":"90 min","subtitle":null,"minutes":90,"startTime":null,"price":429},
     {"label":"2 hrs","subtitle":null,"minutes":120,"startTime":null,"price":549}]',
   5, true)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  price_label = EXCLUDED.price_label,
  badge = EXCLUDED.badge,
  popup_title = EXCLUDED.popup_title,
  highlights = EXCLUDED.highlights,
  pricing = EXCLUDED.pricing,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();


-- =============================================================================
-- service_checklists.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_checklists (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  service_type VARCHAR(50) NOT NULL,
  checklist_name VARCHAR(100) NOT NULL,
  phase VARCHAR(50) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (service_type, phase, checklist_name)
);

CREATE INDEX IF NOT EXISTS idx_service_checklists_service_type
  ON service_checklists (service_type);
CREATE INDEX IF NOT EXISTS idx_service_checklists_phase
  ON service_checklists (phase);
CREATE INDEX IF NOT EXISTS idx_service_checklists_active
  ON service_checklists (is_active);

CREATE TABLE IF NOT EXISTS checklist_items (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  checklist_id UUID NOT NULL REFERENCES service_checklists(id) ON DELETE CASCADE,
  task_name VARCHAR(255) NOT NULL,
  description TEXT,
  sequence_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  estimated_time_minutes INT,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  requires_notes BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist_id
  ON checklist_items (checklist_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_order
  ON checklist_items (checklist_id, sequence_order);

CREATE TABLE IF NOT EXISTS booking_checklist_progress (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_type VARCHAR(50) NOT NULL,
  current_phase VARCHAR(50) NOT NULL DEFAULT 'PRE_SERVICE',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  completion_percentage INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_checklist_progress_booking_id
  ON booking_checklist_progress (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_checklist_progress_phase
  ON booking_checklist_progress (current_phase);
CREATE INDEX IF NOT EXISTS idx_booking_checklist_progress_status
  ON booking_checklist_progress (status);

CREATE TABLE IF NOT EXISTS checklist_item_progress (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  checklist_progress_id UUID NOT NULL REFERENCES booking_checklist_progress(id) ON DELETE CASCADE,
  checklist_item_id UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  photo_url VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checklist_item_progress_progress_id
  ON checklist_item_progress (checklist_progress_id);
CREATE INDEX IF NOT EXISTS idx_checklist_item_progress_item_id
  ON checklist_item_progress (checklist_item_id);

CREATE TABLE IF NOT EXISTS booking_service_execution (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_started_at TIMESTAMPTZ,
  service_completed_at TIMESTAMPTZ,
  actual_duration_minutes INT,
  photos_before TEXT[],
  photos_during TEXT[],
  photos_after TEXT[],
  agent_signature_url VARCHAR(500),
  customer_signature_url VARCHAR(500),
  milestones TEXT[],
  has_overage BOOLEAN NOT NULL DEFAULT FALSE,
  overage_minutes INT NOT NULL DEFAULT 0,
  overage_charge NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_service_execution_booking_id
  ON booking_service_execution (booking_id);

CREATE TABLE IF NOT EXISTS booking_settlement (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  base_amount NUMERIC(10, 2) NOT NULL,
  add_ons_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  surge_charge NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax_percent NUMERIC(5, 2) NOT NULL,
  tax_amount NUMERIC(10, 2) NOT NULL,
  final_amount NUMERIC(10, 2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_signature VARCHAR(255),
  payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  payment_timestamp TIMESTAMPTZ,
  agent_commission_percent NUMERIC(5, 2) NOT NULL,
  agent_commission_amount NUMERIC(10, 2) NOT NULL,
  incentive_percent NUMERIC(5, 2),
  incentive_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  agent_net_payout NUMERIC(10, 2) NOT NULL,
  payout_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  payout_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_settlement_booking_id
  ON booking_settlement (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlement_payment_status
  ON booking_settlement (payment_status);
CREATE INDEX IF NOT EXISTS idx_booking_settlement_payout_status
  ON booking_settlement (payout_status);

CREATE TABLE IF NOT EXISTS booking_customer_feedback (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  rating_stars INT,
  review_text TEXT,
  nps_score INT,
  would_rebook BOOLEAN,
  referral_interest BOOLEAN NOT NULL DEFAULT FALSE,
  testimonial_permission BOOLEAN NOT NULL DEFAULT FALSE,
  feedback_submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_customer_feedback_booking_id
  ON booking_customer_feedback (booking_id);


-- =============================================================================
-- coupon_customers + coupons columns (not in older SQL files)
-- =============================================================================

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS per_customer_limit INTEGER DEFAULT 1;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS description VARCHAR(255);

CREATE TABLE IF NOT EXISTS coupon_customers (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_coupon_customer UNIQUE (coupon_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_customers_coupon ON coupon_customers(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_customers_customer ON coupon_customers(customer_id);
