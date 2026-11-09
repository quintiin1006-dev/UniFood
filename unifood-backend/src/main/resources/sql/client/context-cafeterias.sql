SELECT s.id AS site_id, s.name AS site_name, c.id AS cafeteria_id, c.name AS cafeteria_name,
       COALESCE(d.is_open, false) AS is_open
FROM public.sites s
JOIN public.cafeterias c ON c.site_id = s.id AND c.is_active
LEFT JOIN public.cafeteria_daily_states d ON d.cafeteria_id = c.id AND d.business_date = ?
WHERE s.institution_id = ? AND s.is_active
ORDER BY s.name COLLATE "C", s.id, c.name COLLATE "C", c.id
