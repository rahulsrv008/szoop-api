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

GRANT ALL PRIVILEGES ON home_categories, home_category_options, home_popular_items TO cladmin;

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
