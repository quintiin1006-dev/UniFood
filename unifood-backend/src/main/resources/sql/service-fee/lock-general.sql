SELECT g.fee_cop, g.version, g.updated_at
FROM public.service_fee_settings g
WHERE g.id
FOR UPDATE
