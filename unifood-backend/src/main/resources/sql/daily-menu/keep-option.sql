-- Same label_key: same id, the new text and a new created_at, so the worker's order holds.
UPDATE public.daily_menu_options
SET label = ?, created_at = clock_timestamp()
WHERE cafeteria_id = ? AND business_date = ? AND category_id = ? AND label_key = lower(btrim(?))
