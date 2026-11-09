SELECT id, request_hash FROM public.orders
WHERE client_id = ? AND idempotency_key = ?
