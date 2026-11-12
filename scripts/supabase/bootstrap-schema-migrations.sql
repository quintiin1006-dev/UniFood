-- Bootstrap of the migration registry (docs: unifood-backend/supabase/README.md).
--
-- Creates public.schema_migrations and, only while it is empty, records as 'baseline' the
-- migrations whose objects are already installed. Nothing is assumed per environment:
-- each migration is detected with catalog lookups, so on unifood-staging it records
-- 001-023 (022 is reserved and has no file) and on an empty database it records nothing.
-- A gap (a later migration present while an earlier one is missing) aborts everything.
--
-- apply-migrations.ps1 runs this file itself when the table does not exist. It can also
-- be run by hand once; a second run changes nothing. It lives outside migrations/ on
-- purpose: the local tests install every file of that folder, and this is not a schema
-- change of the product.
--
-- Baseline rows keep the real date and author unknown: applied_at is the moment of the
-- bootstrap and checksum is NULL, so the script cannot check those files for edits.
BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version varchar(3) PRIMARY KEY CHECK (version ~ '^[0-9]{3}$'),
  name text NOT NULL UNIQUE CHECK (name ~ '^[0-9]{3}_[a-z0-9_]+\.sql$' AND left(name, 3) = version),
  applied_at timestamptz NOT NULL DEFAULT now(),
  -- Who: the operator the script sets for the session, or the login role by hand.
  applied_by text NOT NULL
    DEFAULT COALESCE(NULLIF(current_setting('unifood.operator', true), ''), session_user),
  database_role text NOT NULL DEFAULT current_user,
  checksum char(64) CHECK (checksum ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN ('script', 'baseline')),
  CONSTRAINT chk_schema_migrations_checksum CHECK ((source = 'script') = (checksum IS NOT NULL))
);

COMMENT ON TABLE public.schema_migrations IS
  'Migrations of unifood-backend/supabase/migrations applied to this database. Written only by scripts/supabase/apply-migrations.ps1.';

-- Closed to the browser like every business table.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated;

-- Two bootstraps at once: the second waits here and then finds the rows of the first.
LOCK TABLE public.schema_migrations IN EXCLUSIVE MODE;

CREATE TEMP TABLE unifood_detected_migrations ON COMMIT DROP AS
SELECT version, name, present FROM (VALUES
  ('001', '001_initial_schema.sql', to_regclass('public.users') IS NOT NULL),
  ('002', '002_multi_institution.sql', to_regclass('public.institutions') IS NOT NULL),
  ('003', '003_remove_institution_branding.sql', to_regclass('public.institutions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'logo_url')),
  ('004', '004_calls_module.sql', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'not_collected_at')),
  ('005', '005_auth_profiles.sql', to_regprocedure('public.current_auth_profile()') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal)),
  ('006', '006_institution_email_alias.sql',
    to_regprocedure('public.canonical_institution_email_domain(text)') IS NOT NULL),
  ('007', '007_auth_role_cardinality.sql', EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'trg_users_auth_role_lock' AND NOT tgisinternal)),
  ('008', '008_order_concurrency.sql', to_regprocedure('public.advance_order_version()') IS NOT NULL),
  ('009', '009_cafeteria_cardinality.sql', to_regclass('public.cafeteria_profile_guard') IS NOT NULL),
  -- 010 only closes grants: it needs 009 first and the browser role to compare with.
  ('010', '010_backend_business_authority.sql', CASE
    WHEN to_regclass('public.cafeteria_profile_guard') IS NULL OR to_regrole('anon') IS NULL THEN false
    ELSE NOT has_table_privilege('anon', 'public.orders', 'SELECT') END),
  ('011', '011_order_item_integrity.sql', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'cafeteria_id')),
  ('012', '012_catalog_categories.sql', to_regtype('public.catalog_category') IS NOT NULL),
  ('013', '013_daily_availability.sql', to_regclass('public.daily_item_availability') IS NOT NULL),
  ('014', '014_order_cancellation_timestamp.sql',
    to_regprocedure('public.guard_order_cancellation_timestamp()') IS NOT NULL),
  ('015', '015_worker_history_indexes.sql', to_regclass('public.idx_orders_delivered_history') IS NOT NULL),
  ('016', '016_catalog_revision.sql', to_regprocedure('public.advance_lunch_version()') IS NOT NULL),
  ('017', '017_catalog_images.sql', to_regclass('public.catalog_image_operations') IS NOT NULL),
  ('018', '018_secure_registration.sql',
    to_regprocedure('public.complete_registration(text, text, boolean)') IS NOT NULL),
  ('019', '019_catalog_category_bebida.sql', EXISTS (
    SELECT 1 FROM pg_catalog.pg_enum
    WHERE enumtypid = to_regtype('public.catalog_category') AND enumlabel = 'BEBIDA')),
  ('020', '020_order_idempotency.sql', to_regclass('public.uq_orders_client_idempotency_key') IS NOT NULL),
  ('021', '021_order_rejection_and_snapshots.sql', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'client_code')),
  ('023', '023_order_requested_pickup_time.sql', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'requested_pickup_at'))
) AS d(version, name, present);

DO $$
DECLARE
  missing text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations) THEN
    RETURN;
  END IF;
  SELECT string_agg(d.version, ', ' ORDER BY d.version) INTO missing
  FROM unifood_detected_migrations d
  WHERE NOT d.present
    AND EXISTS (SELECT 1 FROM unifood_detected_migrations l WHERE l.present AND l.version > d.version);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRATIONS_BASELINE_GAP: later migrations are installed but not %. Nothing was recorded.', missing;
  END IF;
  INSERT INTO public.schema_migrations (version, name, source)
  SELECT version, name, 'baseline' FROM unifood_detected_migrations WHERE present;
END
$$;

SELECT version, name, source, applied_at, applied_by
FROM public.schema_migrations
ORDER BY version;

COMMIT;

-- Reverse (loses the registry; the next script run bootstraps again):
--
-- BEGIN;
-- DROP TABLE public.schema_migrations;
-- COMMIT;
