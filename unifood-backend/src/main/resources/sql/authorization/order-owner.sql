SELECT c.user_id
FROM public.orders o
LEFT JOIN public.clients c ON c.id = o.client_id
WHERE o.id = ?
