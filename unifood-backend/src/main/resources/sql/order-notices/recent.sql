-- Only the user's notices of orders that still belong to that user's client profile.
SELECT n.id, n.order_id, n.kind, n.sequence, n.created_at, n.read_at IS NOT NULL AS is_read,
       o.status::text IN ('PENDING', 'PREPARING', 'READY', 'CALLED') AS order_active
FROM public.order_notices n
JOIN public.orders o ON o.id = n.order_id
JOIN public.clients c ON c.id = o.client_id AND c.user_id = n.user_id
WHERE n.user_id = ? AND n.created_at >= ?
ORDER BY n.created_at DESC, n.sequence DESC, n.id DESC
LIMIT ?
