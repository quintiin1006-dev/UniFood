INSERT INTO public.orders
  (id, cafeteria_id, client_id, client_name, client_document, status, total, note,
   idempotency_key, request_hash, client_code, client_type)
VALUES (?, ?, ?, ?, NULL, 'PENDING', ?, ?, ?, ?, ?, ?::public.client_type)
