SELECT o.id, o.category_id, o.label
FROM public.daily_menu_options o
WHERE o.cafeteria_id = ? AND o.business_date = ?
ORDER BY o.category_id, o.created_at, o.id
