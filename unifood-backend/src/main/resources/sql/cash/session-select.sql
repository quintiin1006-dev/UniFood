-- Names are display names only: the Auth profile's full_name or a fixed label, never the email.
SELECT s.id, s.cafeteria_id, c.name AS cafeteria_name, s.shift, s.business_date,
       s.sequence_number, s.status, s.opening_float, s.opened_at,
       COALESCE(NULLIF(left(btrim(ou.raw_user_meta_data ->> 'full_name'), 120), ''),
                'Personal de la cafetería') AS opened_by_name,
       s.closed_at,
       CASE WHEN s.closed_by IS NULL THEN NULL
            ELSE COALESCE(NULLIF(left(btrim(cu.raw_user_meta_data ->> 'full_name'), 120), ''),
                          'Personal de la cafetería') END AS closed_by_name,
       s.sales_cash, s.income_total, s.expense_total, s.expected_cash, s.counted_cash,
       s.difference, s.tolerance_cop, s.note, s.pending_orders_at_close, s.forced_close,
       s.reopen_count, s.reopened_at,
       CASE WHEN s.reopened_by IS NULL THEN NULL
            ELSE COALESCE(NULLIF(left(btrim(ru.raw_user_meta_data ->> 'full_name'), 120), ''),
                          'Administrador') END AS reopened_by_name,
       s.reopen_reason, s.version
FROM public.cash_sessions s
JOIN public.cafeterias c ON c.id = s.cafeteria_id
LEFT JOIN auth.users ou ON ou.id = s.opened_by
LEFT JOIN auth.users cu ON cu.id = s.closed_by
LEFT JOIN auth.users ru ON ru.id = s.reopened_by
