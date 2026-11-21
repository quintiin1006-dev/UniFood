SELECT a.id, a.name, a.extra_price, a.active
FROM public.daily_menu_additions a
WHERE a.cafeteria_id = ? AND a.id = ?
FOR SHARE
