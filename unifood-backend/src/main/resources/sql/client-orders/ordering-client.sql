SELECT c.id AS client_id, c.full_name, c.institution_id, c.client_type::text AS client_type,
       c.institutional_code
FROM public.clients c
JOIN public.users u ON u.id = c.user_id AND u.is_active
WHERE c.user_id = ? AND c.institution_id IS NOT NULL AND c.client_type IS NOT NULL
