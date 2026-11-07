-- Read-only: reports which of migrations 001-017 are present. No data is returned.
WITH checks(migration, applied) AS (VALUES
  ('001', to_regclass('public.users') IS NOT NULL),
  ('002', to_regclass('public.institutions') IS NOT NULL),
  ('003', to_regclass('public.institutions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'logo_url')),
  ('004', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'not_collected_at')),
  ('005', to_regprocedure('public.current_auth_profile()') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal)),
  ('006', to_regprocedure('public.canonical_institution_email_domain(text)') IS NOT NULL),
  ('007', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_auth_role_lock' AND NOT tgisinternal)),
  ('008', to_regprocedure('public.advance_order_version()') IS NOT NULL),
  ('009', to_regclass('public.cafeteria_profile_guard') IS NOT NULL),
  -- 010 only closes grants, so it needs 009 first and a guard for an empty project.
  ('010', CASE WHEN to_regclass('public.cafeteria_profile_guard') IS NULL THEN false
               ELSE NOT has_table_privilege('anon', 'public.orders', 'SELECT') END),
  ('011', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'cafeteria_id')),
  ('012', to_regtype('public.catalog_category') IS NOT NULL),
  ('013', to_regclass('public.daily_item_availability') IS NOT NULL),
  ('014', to_regprocedure('public.guard_order_cancellation_timestamp()') IS NOT NULL),
  ('015', to_regclass('public.idx_orders_delivered_history') IS NOT NULL),
  ('016', to_regprocedure('public.advance_lunch_version()') IS NOT NULL),
  ('017', to_regclass('public.catalog_image_operations') IS NOT NULL)
)
SELECT migration, applied FROM checks ORDER BY migration;
