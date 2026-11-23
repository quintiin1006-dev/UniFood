SELECT f.fee_cop, f.version
FROM public.cafeteria_service_fee f
WHERE f.cafeteria_id = ?
FOR UPDATE
