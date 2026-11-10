SELECT o.id, o.status::text AS status, o.updated_at, o.version
FROM public.clients c
JOIN public.users u ON u.id = c.user_id AND u.is_active
LEFT JOIN public.orders o
  ON o.client_id = c.id AND o.status IN ('PENDING', 'PREPARING', 'READY', 'CALLED')
WHERE c.user_id = ?
