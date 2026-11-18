CREATE TABLE IF NOT EXISTS partner_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  partner_type VARCHAR(100) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_inquiries_created_at
  ON partner_inquiries (created_at DESC);
