SELECT m.order_id, m.title_snapshot, m.plate_price
FROM public.order_daily_menus m
WHERE m.order_id = ANY(?)
