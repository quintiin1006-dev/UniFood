SELECT c.id, c.name, (c.is_active AND s.is_active) AS is_active,
       COALESCE(d.is_open, false) AS is_open
FROM public.cafeterias c
JOIN public.sites s ON s.id = c.site_id
LEFT JOIN public.cafeteria_daily_states d ON d.cafeteria_id = c.id AND d.business_date = ?
WHERE c.id = ? AND s.institution_id = ?
