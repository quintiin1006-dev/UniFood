UPDATE public.daily_menu_days
SET title_snapshot = ?, plate_price_snapshot = ?, published_at = now(), published_by = ?,
    updated_at = now()
WHERE cafeteria_id = ? AND business_date = ?
