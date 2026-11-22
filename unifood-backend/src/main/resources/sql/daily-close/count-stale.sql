-- Same states and cut as cancel-stale-pending.sql and not-collect-stale.sql: what is left open.
SELECT count(*)::int FROM public.orders o
WHERE o.status IN ('PENDING', 'PREPARING', 'READY', 'CALLED') AND o.created_at < ?
