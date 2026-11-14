-- Who changed it is a display name only: the Auth profile's full_name, or a fixed label.
-- Never the email or the id. A manual SQL change has no author.
SELECT a.setting,
       a.old_value::text AS old_value,
       a.new_value::text AS new_value,
       a.changed_at,
       a.source,
       CASE
         WHEN a.changed_by IS NULL THEN NULL
         ELSE COALESCE(NULLIF(left(btrim(au.raw_user_meta_data ->> 'full_name'), 120), ''),
                       'Administrador global')
       END AS changed_by_name
FROM public.cafeteria_settings_audit a
LEFT JOIN auth.users au ON au.id = a.changed_by
WHERE a.cafeteria_id = ?
ORDER BY a.changed_at DESC, a.id DESC
LIMIT ?
