SELECT c.id,
       c.name,
       c.is_active AS visible,
       EXISTS (SELECT 1
               FROM public.cafeteria_users cu
               JOIN public.users u ON u.id = cu.user_id
               JOIN public.user_roles ur ON ur.user_id = u.id
               JOIN public.roles r ON r.id = ur.role_id
               WHERE cu.cafeteria_id = c.id
                 AND u.is_active
                 AND r.name::text = 'ADMIN') AS has_active_admin,
       b.billing_model,
       b.per_order_fee_cop,
       b.subscription_fee_cop,
       b.version AS billing_version
FROM public.cafeterias c
JOIN public.cafeteria_billing_settings b ON b.cafeteria_id = c.id
WHERE c.id = ?
