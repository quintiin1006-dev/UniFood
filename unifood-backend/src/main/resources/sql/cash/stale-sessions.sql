SELECT s.id, s.cafeteria_id, c.name AS cafeteria_name, s.business_date, s.shift, s.opened_at
FROM public.cash_sessions s
JOIN public.cafeterias c ON c.id = s.cafeteria_id
WHERE s.status IN ('OPEN', 'REOPENED')
  AND s.business_date < ?
  AND (CAST(? AS uuid) IS NULL OR s.cafeteria_id = ?)
ORDER BY s.business_date, c.name
