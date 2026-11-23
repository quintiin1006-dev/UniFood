SELECT c.id AS cafeteria_id, c.name AS cafeteria_name, s.name AS site_name,
       c.is_active AS visible, f.fee_cop, COALESCE(f.version, 0) AS version
FROM public.cafeterias c
JOIN public.sites s ON s.id = c.site_id
LEFT JOIN public.cafeteria_service_fee f ON f.cafeteria_id = c.id
WHERE c.id = ?
