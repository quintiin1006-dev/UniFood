UPDATE public.daily_menu_days
SET version = version + 1, updated_at = now()
WHERE cafeteria_id = ? AND business_date = ?
RETURNING version
