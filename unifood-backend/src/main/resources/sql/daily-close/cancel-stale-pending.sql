-- Same rule as scripts/supabase/close-stale-orders.sql. Locked rows wait for the next run.
WITH stale AS (
  SELECT o.id FROM public.orders o
  WHERE o.status = 'PENDING' AND o.created_at < ?
  FOR UPDATE SKIP LOCKED
)
UPDATE public.orders o
  SET status = 'CANCELLED', cancelled_at = ?, cancellation_source = 'SYSTEM'
  FROM stale s
  WHERE o.id = s.id
