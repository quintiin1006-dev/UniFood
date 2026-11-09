SELECT c.id, (c.is_active AND s.is_active) AS is_active
FROM public.cafeterias c
JOIN public.sites s ON s.id = c.site_id
WHERE c.id = ? AND s.institution_id = ?
FOR SHARE OF c
