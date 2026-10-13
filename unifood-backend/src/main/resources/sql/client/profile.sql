SELECT c.document, c.phone, i.name AS institution
FROM public.clients c
LEFT JOIN public.institutions i ON i.id = c.institution_id AND i.is_active
WHERE c.user_id = ?
