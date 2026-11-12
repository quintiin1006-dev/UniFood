-- EMERGENCY manual daily close (docs/decisiones.md §6 and §11). Since B19 Spring runs the
-- same rule at startup and every hour; use this only if that job is disabled
-- (DAILY_CLOSE_ENABLED=false) or failing. Needs migrations 001-021.
--
-- Closes active orders created before today's business day in America/Bogota:
--   PENDING                   -> CANCELLED, cancellation_source = 'SYSTEM', cancelled_at = now()
--   PREPARING, READY, CALLED  -> NOT_COLLECTED, not_collected_at = now()
-- Today's orders and finished ones are never touched. Each closed order also gets a new
-- version (008), so clients and workers see the change on their next poll.
--
-- A DRY RUN by default: it only lists what it would close. To close for real, run this
-- line first, in the same run:
--   SET unifood.close_stale_orders = 'apply';
--
-- Orders locked by a worker right now are skipped (SKIP LOCKED); run it again later.
-- Running it twice is harmless: the second run finds nothing to close.
BEGIN;

DO $$
BEGIN
  IF COALESCE(current_setting('unifood.close_stale_orders', true), '') NOT IN ('', 'apply') THEN
    RAISE EXCEPTION 'unifood.close_stale_orders must be ''apply'' or unset (dry run).';
  END IF;
END;
$$;

SELECT CASE
  WHEN current_setting('unifood.close_stale_orders', true) = 'apply' THEN 'apply'
  ELSE 'dry run: nothing changes'
END AS mode,
(date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')
  AS business_day_start;

-- What the close covers, in both modes. No personal data: ids, states and dates only.
SELECT o.id, o.cafeteria_id, o.status::text AS current_status,
       CASE WHEN o.status = 'PENDING' THEN 'CANCELLED' ELSE 'NOT_COLLECTED' END AS closes_as,
       o.created_at
FROM public.orders o
WHERE o.status IN ('PENDING', 'PREPARING', 'READY', 'CALLED')
  AND o.created_at < (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')
ORDER BY o.created_at, o.id;

WITH stale AS (
  SELECT o.id FROM public.orders o
  WHERE current_setting('unifood.close_stale_orders', true) = 'apply'
    AND o.status = 'PENDING'
    AND o.created_at < (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')
  FOR UPDATE SKIP LOCKED
)
UPDATE public.orders o
  SET status = 'CANCELLED', cancelled_at = now(), cancellation_source = 'SYSTEM', updated_at = now()
  FROM stale s
  WHERE o.id = s.id
  RETURNING o.id, 'CANCELLED' AS closed_as;

WITH stale AS (
  SELECT o.id FROM public.orders o
  WHERE current_setting('unifood.close_stale_orders', true) = 'apply'
    AND o.status IN ('PREPARING', 'READY', 'CALLED')
    AND o.created_at < (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')
  FOR UPDATE SKIP LOCKED
)
UPDATE public.orders o
  SET status = 'NOT_COLLECTED', not_collected_at = now(), updated_at = now()
  FROM stale s
  WHERE o.id = s.id
  RETURNING o.id, 'NOT_COLLECTED' AS closed_as;

COMMIT;
