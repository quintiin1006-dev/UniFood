-- Daily close at 00:05 in Bogota with pg_cron, for unifood-staging ONLY
-- (docs/propuesta-menu-dinamico.md, sections 8.3 and 8.4). Never run it on the real project:
-- production needs its own, separate OK. This file is NOT a migration and the migration runner
-- never reads it.
--
-- Needs migration 032 (public.close_stale_orders()). Run in the SQL Editor of unifood-staging,
-- as postgres, with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
-- The file does not set it itself: without that line the guard stops everything.
--
-- Schedule: '5 5 * * *' is 05:05 UTC = 00:05 in America/Bogota (UTC-5, no daylight saving).
-- pg_cron reads schedules in UTC on Supabase. The function computes its own cut in Bogota.
--
-- Safe to run again: an existing «cierre-diario-bogota» job is removed and created once more,
-- so there is never more than one.
--
-- Check the runs (the newest first):
--   SELECT j.jobname, d.status, d.return_message, d.start_time, d.end_time
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
--   WHERE j.jobname = 'cierre-diario-bogota'
--   ORDER BY d.start_time DESC LIMIT 10;
-- Check the job itself:
--   SELECT jobid, jobname, schedule, command, active FROM cron.job
--   WHERE jobname = 'cierre-diario-bogota';
-- Unschedule it:
--   SELECT cron.unschedule('cierre-diario-bogota');
BEGIN;

DO $$
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'schedule-daily-close-staging.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF to_regprocedure('public.close_stale_orders()') IS NULL THEN
    RAISE EXCEPTION 'schedule-daily-close-staging.sql needs migration 032 (close_stale_orders). Apply it first.';
  END IF;
END;
$$;

-- Supabase's documented form; a no-op when pg_cron is already enabled.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'cierre-diario-bogota';
  PERFORM cron.schedule(
    'cierre-diario-bogota',
    '5 5 * * *',
    'SELECT public.close_stale_orders()'
  );
END;
$$;

SELECT jobid, jobname, schedule, command, active
FROM cron.job WHERE jobname = 'cierre-diario-bogota';

COMMIT;
