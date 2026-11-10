SELECT c.id FROM public.clients c
JOIN public.users u ON u.id = c.user_id AND u.is_active
WHERE c.user_id = ?
