CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS service_checklists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
