SELECT m.id, m.kind, m.amount, m.reason, m.created_at,
       COALESCE(NULLIF(left(btrim(u.raw_user_meta_data ->> 'full_name'), 120), ''),
                'Personal de la cafetería') AS created_by_name
FROM public.cash_movements m
LEFT JOIN auth.users u ON u.id = m.created_by
