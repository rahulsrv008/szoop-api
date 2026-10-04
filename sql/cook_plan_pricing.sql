-- Morning / Evening / Both shifts for cook plans. Safe to re-run.

UPDATE home_category_options
SET
  pricing = '[
    {"label":"Morning","subtitle":"6 AM – 11 AM","minutes":45,"startTime":"08:00","price":1200},
    {"label":"Evening","subtitle":"4:45 PM – 9:45 PM","minutes":45,"startTime":"16:45","price":1200},
    {"label":"Both","subtitle":"Morning & evening","minutes":45,"startTime":"08:00","price":2000}
  ]'::jsonb,
  updated_at = NOW()
WHERE id IN (
  'b1b00000-0000-4000-8000-000000000001',
  'b1b00000-0000-4000-8000-000000000003'
)
AND (pricing IS NULL OR pricing = '[]'::jsonb OR jsonb_array_length(pricing) = 0);
