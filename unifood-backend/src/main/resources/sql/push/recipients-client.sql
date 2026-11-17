-- The order's own client, while the account is active.
SELECT s.id, s.user_id, s.channel, s.endpoint, s.p256dh, s.auth
FROM public.orders o
JOIN public.clients c ON c.id = o.client_id
JOIN public.users u ON u.id = c.user_id AND u.is_active
JOIN public.push_subscriptions s
  ON s.user_id = c.user_id AND s.role = 'CLIENT' AND s.revoked_at IS NULL
WHERE o.id = ?
ORDER BY s.last_seen_at DESC
LIMIT 5
