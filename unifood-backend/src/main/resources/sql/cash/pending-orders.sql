SELECT o.id, o.status::text AS status, o.client_name, o.created_at
FROM public.orders o
WHERE o.cafeteria_id = ? AND o.status IN ('READY', 'CALLED')
ORDER BY o.created_at, o.id
