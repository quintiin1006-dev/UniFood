SELECT id, status::text AS status, total, note, created_at FROM public.orders WHERE id = ?
