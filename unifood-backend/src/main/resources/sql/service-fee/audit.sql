-- Who changed it is a display name only, as in super-admin/audit.sql: never the email or the id.
SELECT a.action, a.cafeteria_id, c.name AS cafeteria_name, a.period_month,
       a.old_value::text AS old_value, a.new_value::text AS new_value, a.changed_at, a.source,
       CASE
         WHEN a.changed_by IS NULL THEN NULL
         ELSE COALESCE(NULLIF(left(btrim(au.raw_user_meta_data ->> 'full_name'), 120), ''),
                       'Administrador global')
       END AS changed_by_name
FROM public.service_fee_audit a
LEFT JOIN public.cafeterias c ON c.id = a.cafeteria_id
LEFT JOIN auth.users au ON au.id = a.changed_by
ORDER BY a.changed_at DESC, a.id DESC
LIMIT ?
