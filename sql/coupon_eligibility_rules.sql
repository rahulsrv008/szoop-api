-- Coupon Eligibility Rules table and Coupons linkage
CREATE TABLE IF NOT EXISTS coupon_eligibility_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
