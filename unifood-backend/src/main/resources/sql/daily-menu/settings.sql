SELECT s.title, s.plate_price
FROM public.daily_menu_settings s
WHERE s.cafeteria_id = ?
