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
