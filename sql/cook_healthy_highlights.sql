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
