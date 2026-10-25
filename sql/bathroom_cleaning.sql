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
