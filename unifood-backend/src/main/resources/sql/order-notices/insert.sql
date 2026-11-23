-- The order's own client, from the database; a repeated event is ignored.
INSERT INTO public.order_notices (user_id, order_id, cafeteria_id, kind, sequence, created_at)
SELECT c.user_id, o.id, o.cafeteria_id, ?, ?, ?
FROM public.orders o
JOIN public.clients c ON c.id = o.client_id
WHERE o.id = ?
ON CONFLICT (order_id, kind, sequence) DO NOTHING
