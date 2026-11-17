-- Device limit: keeps the most recently seen active devices and revokes the oldest beyond it.
UPDATE public.push_subscriptions
SET revoked_at = now()
WHERE id IN (
  SELECT id
  FROM public.push_subscriptions
  WHERE user_id = ? AND revoked_at IS NULL
  ORDER BY last_seen_at DESC, created_at DESC, id
  OFFSET ?
)
