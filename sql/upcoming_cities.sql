-- "Coming soon" cities and the customers waiting on them.
-- Safe to re-run. Also ensured at boot by ServiceabilityService, which seeds
-- the rows from src/database/seeds/upcoming-cities.data.ts.

CREATE TABLE IF NOT EXISTS upcoming_cities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
