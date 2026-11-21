SELECT d.version, d.published_at IS NOT NULL AS published, d.title_snapshot, d.plate_price_snapshot
FROM public.daily_menu_days d
WHERE d.cafeteria_id = ? AND d.business_date = ?
