SELECT c.name AS cafeteria_name, c.is_active AS cafeteria_active,
       s.name AS site_name, i.name AS institution_name
FROM public.cafeteria_users cu
LEFT JOIN public.cafeterias c ON c.id = cu.cafeteria_id
LEFT JOIN public.sites s ON s.id = c.site_id
LEFT JOIN public.institutions i ON i.id = s.institution_id
WHERE cu.user_id = ? AND cu.cafeteria_id = ?
