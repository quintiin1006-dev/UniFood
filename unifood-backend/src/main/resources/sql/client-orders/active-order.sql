SELECT id FROM public.orders
WHERE client_id = ? AND status IN ('PENDING', 'PREPARING', 'READY', 'CALLED')
LIMIT 1
