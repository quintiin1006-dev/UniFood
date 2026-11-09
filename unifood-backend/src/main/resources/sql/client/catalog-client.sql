SELECT c.id AS client_id, c.full_name, c.client_type::text AS client_type,
       i.id AS institution_id, i.name AS institution_name
FROM public.clients c
JOIN public.institutions i ON i.id = c.institution_id
WHERE c.user_id = ?
