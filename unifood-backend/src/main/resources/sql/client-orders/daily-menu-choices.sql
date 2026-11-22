SELECT c.order_id, c.category_label, c.line_kind, c.option_label, c.extra_price
FROM public.order_daily_menu_choices c
WHERE c.order_id = ANY(?)
ORDER BY c.order_id, c.created_at, c.id
