-- FOR SHARE: a worker write holds FOR UPDATE, so the order sees the whole menu before or after it.
SELECT d.title_snapshot, d.plate_price_snapshot, d.published_at IS NOT NULL AS published
FROM public.daily_menu_days d
WHERE d.cafeteria_id = ? AND d.business_date = ?
FOR SHARE
