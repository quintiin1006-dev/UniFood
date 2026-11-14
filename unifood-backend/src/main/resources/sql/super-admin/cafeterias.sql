SELECT i.id AS institution_id,
       i.name AS institution_name,
       i.is_active AS institution_active,
       s.id AS site_id,
       s.name AS site_name,
       s.city AS site_city,
       s.is_active AS site_active,
       c.id AS cafeteria_id,
       c.name AS cafeteria_name,
       c.is_active AS cafeteria_visible,
       EXISTS (SELECT 1
               FROM public.cafeteria_users cu
               JOIN public.users u ON u.id = cu.user_id
               JOIN public.user_roles ur ON ur.user_id = u.id
               JOIN public.roles r ON r.id = ur.role_id
               WHERE cu.cafeteria_id = c.id
                 AND u.is_active
                 AND r.name::text = 'ADMIN') AS cafeteria_has_active_admin,
       b.billing_model,
       b.per_order_fee_cop,
       b.subscription_fee_cop,
       b.version AS billing_version
FROM public.institutions i
LEFT JOIN public.sites s ON s.institution_id = i.id
LEFT JOIN public.cafeterias c ON c.site_id = s.id
LEFT JOIN public.cafeteria_billing_settings b ON b.cafeteria_id = c.id
ORDER BY i.name, i.id, s.name, s.id, c.name, c.id
