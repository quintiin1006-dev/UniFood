-- The endpoint identifies the browser: registering it again reactivates it, and an endpoint that
-- another account registered on this browser moves to the current account (shared device).
INSERT INTO public.push_subscriptions AS s
  (user_id, role, cafeteria_id, channel, endpoint, p256dh, auth, user_agent)
VALUES (?, ?, ?, 'WEB_PUSH', ?, ?, ?, ?)
ON CONFLICT (endpoint) DO UPDATE SET
  created_at = CASE WHEN s.user_id = EXCLUDED.user_id THEN s.created_at ELSE now() END,
  user_id = EXCLUDED.user_id,
  role = EXCLUDED.role,
  cafeteria_id = EXCLUDED.cafeteria_id,
  channel = EXCLUDED.channel,
  p256dh = EXCLUDED.p256dh,
  auth = EXCLUDED.auth,
  user_agent = EXCLUDED.user_agent,
  last_seen_at = now(),
  revoked_at = NULL
RETURNING s.id
