SELECT d.title_snapshot, d.plate_price_snapshot
FROM public.daily_menu_days d
WHERE d.cafeteria_id = ? AND d.business_date = ? AND d.published_at IS NOT NULL
