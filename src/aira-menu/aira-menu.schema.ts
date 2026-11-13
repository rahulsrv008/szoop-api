/** Same tables as sql/aira_beauty_menu.sql; run on boot so a fresh database is ready. */
export const AIRA_MENU_SQL = `
CREATE TABLE IF NOT EXISTS aira_beauty_groups (
  id VARCHAR(40) PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  blurb VARCHAR(200),
  icon VARCHAR(40) NOT NULL DEFAULT 'sparkles',
  segment VARCHAR(20) NOT NULL DEFAULT 'women',
  image_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aira_beauty_items (
  id VARCHAR(40) PRIMARY KEY,
  group_id VARCHAR(40) NOT NULL REFERENCES aira_beauty_groups(id) ON UPDATE CASCADE,
  kind VARCHAR(10) NOT NULL DEFAULT 'service',
  title VARCHAR(120) NOT NULL,
  section VARCHAR(60) NOT NULL,
  minutes INT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  rating NUMERIC(3,2),
  reviews_count INT,
  badge VARCHAR(30),
  segment VARCHAR(20),
  includes JSONB NOT NULL DEFAULT '[]',
  image_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aira_beauty_items_group ON aira_beauty_items (group_id);
`;
