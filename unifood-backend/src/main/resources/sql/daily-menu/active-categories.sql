SELECT c.id, c.label, c.kind, c.can_skip
FROM public.daily_menu_categories c
WHERE c.cafeteria_id = ? AND c.active
ORDER BY c.position
