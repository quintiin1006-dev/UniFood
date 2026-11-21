-- The snapshots stay as history; the next publication freezes them again.
UPDATE public.daily_menu_days
SET published_at = NULL, published_by = NULL, updated_at = now()
WHERE cafeteria_id = ? AND business_date = ?
