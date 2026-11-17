-- Active, exclusive workers still assigned to the order's cafeteria; the cafeteria stored with the
-- subscription is checked again against cafeteria_users, so a reassigned worker gets nothing.
SELECT s.id, s.user_id, s.channel, s.endpoint, s.p256dh, s.auth
FROM public.orders o
JOIN public.push_subscriptions s
  ON s.cafeteria_id = o.cafeteria_id AND s.role = 'WORKER' AND s.revoked_at IS NULL
JOIN public.users u ON u.id = s.user_id AND u.is_active
JOIN public.cafeteria_users cu ON cu.user_id = s.user_id AND cu.cafeteria_id = o.cafeteria_id
WHERE o.id = ?
  AND (
    SELECT array_agg(r.name::text)
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = s.user_id
  ) = ARRAY['WORKER']
  AND (SELECT count(*) FROM public.cafeteria_users other WHERE other.user_id = s.user_id) = 1
ORDER BY s.last_seen_at DESC
LIMIT 100
