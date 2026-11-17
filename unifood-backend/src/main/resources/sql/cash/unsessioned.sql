-- Delivered orders of the day outside every session window (open sessions are open-ended).
SELECT count(*) AS orders, COALESCE(round(sum(o.total)), 0)::bigint AS amount
FROM public.orders o
WHERE o.cafeteria_id = ?
  AND o.status = 'DELIVERED'
  AND o.delivered_at >= ?
  AND o.delivered_at < ?
  AND NOT EXISTS (
    SELECT 1 FROM public.cash_sessions s
    WHERE s.cafeteria_id = o.cafeteria_id
      AND o.delivered_at >= s.opened_at
      AND (s.closed_at IS NULL OR o.delivered_at < s.closed_at))
