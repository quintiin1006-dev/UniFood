SELECT u.is_active,
       ARRAY(SELECT r.name::text
             FROM public.user_roles ur
             JOIN public.roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id) AS roles,
       ARRAY(SELECT cu.cafeteria_id
             FROM public.cafeteria_users cu
             WHERE cu.user_id = u.id
             LIMIT 2) AS cafeteria_ids
FROM public.users u
WHERE u.id = ?
