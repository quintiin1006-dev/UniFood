BEGIN;

-- Daily close as a database function (docs/propuesta-menu-dinamico.md, section 8, PR C), so it
-- can run at 00:05 in Bogota with the backend off. It ONLY creates the function: the schedule
-- (pg_cron) is per environment, in scripts/supabase/schedule-daily-close-staging.sql.
--
-- The rule is the backend's, word for word (resources/sql/daily-close/*.sql and
-- DailyCloseService): orders created before the start of today's business day in
-- America/Bogota, never the server's date:
--   PENDING                   -> CANCELLED, cancellation_source = 'SYSTEM', cancelled_at = now()
--   PREPARING, READY, CALLED  -> NOT_COLLECTED, not_collected_at = now()
-- reminder_count, called_at and the other columns stay as they are, as in the backend.
-- updated_at and version are set by their triggers (001 trg_orders_updated_at, 008).
-- Rows locked right now are skipped (SKIP LOCKED) and wait for the next run; a second run
-- closes nothing. Returns how many orders it closed.
--
-- search_path is empty: every name carries its schema. Only the owner (pg_cron runs as it)
-- may call it.

CREATE OR REPLACE FUNCTION public.close_stale_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  day_start timestamptz :=
    (date_trunc('day', pg_catalog.now() AT TIME ZONE 'America/Bogota'))
      AT TIME ZONE 'America/Bogota';
  cancelled integer;
  not_collected integer;
BEGIN
  WITH stale AS (
    SELECT o.id FROM public.orders o
    WHERE o.status = 'PENDING' AND o.created_at < day_start
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.orders o
    SET status = 'CANCELLED', cancelled_at = pg_catalog.now(), cancellation_source = 'SYSTEM'
    FROM stale s
    WHERE o.id = s.id;
  GET DIAGNOSTICS cancelled = ROW_COUNT;

  WITH stale AS (
    SELECT o.id FROM public.orders o
    WHERE o.status IN ('PREPARING', 'READY', 'CALLED') AND o.created_at < day_start
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.orders o
    SET status = 'NOT_COLLECTED', not_collected_at = pg_catalog.now()
    FROM stale s
    WHERE o.id = s.id;
  GET DIAGNOSTICS not_collected = ROW_COUNT;

  RETURN cancelled + not_collected;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_orders() FROM PUBLIC, anon, authenticated;

COMMIT;
