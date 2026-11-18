BEGIN;

-- Retires the cash register (caja) introduced by 028_cash_sessions.sql. The product owner
-- decided caja leaves for now and will be redesigned later (docs/decisiones.md §14).
--
-- 028 stays in the history and is never edited or reused: it is applied in staging and its
-- checksum is recorded. This migration only removes what 028 created, in dependency order.
-- Every statement is re-runnable (IF EXISTS).
--
-- Why DROP TABLE is enough: the "no delete / no truncate" triggers of 028 guard DELETE and
-- TRUNCATE statements only; DROP TABLE drops the table and its triggers without firing them.
-- Nothing is dropped with CASCADE, so no object outside 028 is touched (cafeterias and users
-- are only referenced by 028's foreign keys, which go away with their tables).
--
-- The CASH_TOLERANCE rows of cafeteria_settings_audit (written by 028) are append-only and
-- stay, so the wider CHECK added by 028 stays too.

-- The trigger that created a cash settings row for each new cafeteria (on cafeterias, which
-- stays). Dropped first, so the function it calls can go.
DROP TRIGGER IF EXISTS trg_cafeterias_cash_settings_row ON public.cafeterias;
DROP FUNCTION IF EXISTS public.create_cafeteria_cash_settings();

-- The snapshot function takes a cash_sessions row as its argument type, so it must go before
-- the table that defines that type.
DROP FUNCTION IF EXISTS public.cash_session_snapshot(public.cash_sessions, boolean);

-- Tables, in dependency order. Their triggers, indexes, constraints, grants and the
-- cash_sessions_audit identity sequence are dropped with them.
DROP TABLE IF EXISTS public.cash_count_lines;
DROP TABLE IF EXISTS public.cash_movements;
DROP TABLE IF EXISTS public.cash_sessions_audit;
DROP TABLE IF EXISTS public.cash_sessions;
DROP TABLE IF EXISTS public.cafeteria_cash_settings;

-- Trigger functions left without a trigger.
DROP FUNCTION IF EXISTS public.audit_cafeteria_cash_tolerance();
DROP FUNCTION IF EXISTS public.audit_cash_movement();
DROP FUNCTION IF EXISTS public.audit_cash_session();
DROP FUNCTION IF EXISTS public.guard_cash_count_line();
DROP FUNCTION IF EXISTS public.guard_cash_movement();
DROP FUNCTION IF EXISTS public.guard_cash_session_update();
DROP FUNCTION IF EXISTS public.reject_cash_record_delete();
DROP FUNCTION IF EXISTS public.reject_cash_sessions_audit_change();

COMMIT;

-- Reverse: not provided. Re-adding caja means recreating the schema with a NEW migration
-- (see docs/despliegue-staging.md). 028 must never be reused for that.
