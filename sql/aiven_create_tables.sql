-- ClearIT schema for the Aiven database (defaultdb).
-- Run as avnadmin. Safe grants to the local role cladmin are omitted.
-- 001 drops and recreates the core tables. Re-running this file wipes app data.

-- ===== 001_full_schema.sql =====
-- Full CleanIt schema (32 tables) — run on the existing `clearit` database.
-- This replaces the 6-table STG slice. Re-running drops and recreates these tables.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS
  audit_logs,
  coupon_usage,
  coupons,
  support_tickets,
  notifications,
  reviews,
  ratings,
  salary_records,
  agent_incentives,
  agent_earnings,
  payment_transactions,
  payments,
  agent_bank_accounts,
  agent_documents,
  agent_attendance,
  agent_locations,
  agent_availability,
  booking_status_history,
  booking_items,
  bookings,
  service_pricing,
  services,
  service_categories,
  service_areas,
  societies,
  customer_addresses,
  refresh_tokens,
  otp_verifications,
  admins,
  agents,
  customers,
  users,
  -- old 6-table names
  tracking_pings,
  otp_sessions,
  addresses
CASCADE;

-- 1. Identity
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(255),
    user_type VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    profile_image TEXT,
    gender VARCHAR(20),
    date_of_birth DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE TABLE otp_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mobile VARCHAR(15) NOT NULL,
    otp_hash TEXT NOT NULL,
    purpose VARCHAR(30) NOT NULL,
    attempts INT DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_otp_mobile ON otp_verifications(mobile);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Customer address
CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES service_categories(id),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    duration_minutes INT DEFAULT 60,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id),
    service_area_id UUID REFERENCES service_areas(id),
    price_per_hour DECIMAL(10,2) NOT NULL,
    agent_payout_per_hour DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE societies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE booking_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    service_id UUID NOT NULL REFERENCES services(id),
    quantity INT DEFAULT 1,
    duration_minutes INT,
    price_per_hour DECIMAL(10,2),
    amount DECIMAL(10,2)
);

CREATE TABLE booking_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    status VARCHAR(30) NOT NULL,
    changed_by UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Agent ops
CREATE TABLE agent_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    availability_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    booking_id UUID REFERENCES bookings(id),
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    attendance_date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    document_url TEXT,
    verification_status VARCHAR(30) DEFAULT 'PENDING',
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    account_holder_name VARCHAR(150),
    account_number VARCHAR(100),
    ifsc_code VARCHAR(20),
    bank_name VARCHAR(150),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Payments + earnings
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(30),
    payment_status VARCHAR(30) DEFAULT 'PENDING',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    gateway_name VARCHAR(50),
    gateway_transaction_id VARCHAR(150),
    gateway_response JSONB,
    status VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    booking_id UUID REFERENCES bookings(id),
    service_hours DECIMAL(8,2) DEFAULT 0,
    revenue_generated DECIMAL(10,2) DEFAULT 0,
    earning_amount DECIMAL(10,2) DEFAULT 0,
    earning_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_incentives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    month INT NOT NULL,
    year INT NOT NULL,
    revenue_generated DECIMAL(10,2) DEFAULT 0,
    threshold_amount DECIMAL(10,2) DEFAULT 15000,
    incentive_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salary_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    rating DECIMAL(2,1) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rating_id UUID NOT NULL REFERENCES ratings(id),
    review_text TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(200),
    message TEXT,
    notification_type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE coupon_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coupon_id UUID NOT NULL REFERENCES coupons(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id),
    discount_amount DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_user_id ON customers(user_id);
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX idx_bookings_agent_id ON bookings(agent_id);
CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_agent_locations_agent_id ON agent_locations(agent_id);
CREATE INDEX idx_agent_locations_booking_id ON agent_locations(booking_id);
CREATE INDEX idx_agent_earnings_agent_id ON agent_earnings(agent_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_support_tickets_user_id ON support_tickets(user_id);

-- ===== 002_auth_devices_settings.sql =====
-- 002: additions needed by the three-app API layer.
--  * refresh_tokens can now belong to an admin (admins live outside `users`)
--  * device_tokens stores FCM registration ids for push
--  * system_settings backs Admin Web → Settings
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Refresh tokens for admin sessions
ALTER TABLE refresh_tokens ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_owner_chk'
  ) THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_owner_chk
      CHECK ((user_id IS NOT NULL) <> (admin_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens(admin_id);

-- 2. Push device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  ('booking_cancellation_window_minutes', '60'::jsonb, 'Minutes before start time a customer may cancel free of charge')
ON CONFLICT (setting_key) DO NOTHING;

-- ===== agent_address.sql =====
-- Live address captured from the agent map, plus optional passbook scans.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS locality VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(12),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);

-- ===== agent_bank_accounts.sql =====
-- Payout bank account saved from agent onboarding.
-- Safe to run on an existing ClearIt database.

CREATE TABLE IF NOT EXISTS agent_bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- ===== agent_skills_boost.sql =====
-- Incremental: skills catalog, agent skill selections, booking boost.
-- Safe to run on an existing ClearIt database.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS boost_enabled BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_id UUID NOT NULL REFERENCES skills(id),
    selected BOOLEAN DEFAULT FALSE,
    training_status VARCHAR(30) DEFAULT 'UNVERIFIED',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent_id ON agent_skills(agent_id);

-- ===== home_content.sql =====
-- Customer app home: admin-managed category tiles, their options, and "Most popular" cards.
-- Safe to re-run: tables use IF NOT EXISTS and seed rows use fixed ids with ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS home_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  ('a1a00000-0000-4000-8000-000000000003', 'Aira Luxe', 'Premium care for premium homes', 'COMING SOON',
   '#2E1A3D', 'FULL', 'COMING_SOON', NULL, '[]', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO home_category_options
  (id, category_id, title, subtitle, price_label, badge, popup_title, highlights, sort_order)
VALUES
  ('b1b00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000002',
   'Healthy Cook', 'Healthy home-style & diet meals, every day', '₹4,999 / month', 'HEALTHY', 'What your cook will do',
   '[{"text":"Healthy, balanced home-style meals","icon":"leaf"},
     {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
     {"text":"Plans a weekly menu with you","icon":"calendar"},
     {"text":"Cooks 2 fresh meals a day","icon":"restaurant"},
     {"text":"Chops, preps & stores groceries","icon":"basket"},
     {"text":"Cleans the kitchen after cooking","icon":"sparkles"},
     {"text":"Hygiene-checked & verified cook","icon":"shield-checkmark"}]', 1),
  ('b1b00000-0000-4000-8000-000000000002', 'a1a00000-0000-4000-8000-000000000002',
   'House Cleaning', 'A spotless home, daily', '₹3,999 / month', NULL, 'What your expert will do',
   '[{"text":"Daily sweeping & mopping","icon":"home"},
     {"text":"Dishes & kitchen cleanup","icon":"water"},
     {"text":"Bathroom cleaning twice a week","icon":"sparkles"},
     {"text":"Dusting & tidying every room","icon":"leaf"},
     {"text":"Same trusted expert every day","icon":"person"}]', 2),
  ('b1b00000-0000-4000-8000-000000000003', 'a1a00000-0000-4000-8000-000000000002',
   'Cook + Cleaning', 'Both, bundled & cheaper', '₹7,999 / month', 'BEST VALUE', 'Everything in one pass',
   '[{"text":"Healthy, balanced home-style meals","icon":"leaf"},
     {"text":"Diet & calorie-aware meal preparation","icon":"nutrition"},
     {"text":"Everything in Healthy Cook","icon":"restaurant"},
     {"text":"Everything in House Cleaning","icon":"home"},
     {"text":"Dedicated, verified experts","icon":"people"},
     {"text":"Free replacement when on leave","icon":"swap-horizontal"},
     {"text":"Priority support","icon":"star"}]', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO home_popular_items
  (id, title, subtitle, price_label, badge, rating, category_id, option_id, sort_order)
VALUES
  ('c1c00000-0000-4000-8000-000000000001', 'Hourly Help · 2 hrs', 'Quick clean-up by a verified expert',
   '₹398', 'TRENDING', 4.8, 'a1a00000-0000-4000-8000-000000000001', NULL, 1),
  ('c1c00000-0000-4000-8000-000000000002', 'Healthy Cook Pass', 'Healthy home-style & diet meals, every day',
   '₹4,999 / mo', 'HEALTHY', 4.7, 'a1a00000-0000-4000-8000-000000000002', 'b1b00000-0000-4000-8000-000000000001', 2),
  ('c1c00000-0000-4000-8000-000000000003', 'Cook + Cleaning Pass', 'Our best-value monthly plan',
   '₹7,999 / mo', 'BEST VALUE', 4.9, 'a1a00000-0000-4000-8000-000000000002', 'b1b00000-0000-4000-8000-000000000003', 3)
ON CONFLICT (id) DO NOTHING;

-- ===== plan_bookings.sql =====
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

-- ===== on_demand_services.sql =====
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
