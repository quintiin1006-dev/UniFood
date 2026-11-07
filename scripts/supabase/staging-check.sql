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

-- Read-only: objects of migration 018. Every row must say true. No data is returned.
WITH checks(object, ok) AS (VALUES
  ('pg_cron extension', EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron')),
  ('table institution_email_domains', to_regclass('public.institution_email_domains') IS NOT NULL),
  ('table identity_preauthorizations', to_regclass('public.identity_preauthorizations') IS NOT NULL),
  ('table pending_registrations', to_regclass('public.pending_registrations') IS NOT NULL),
  ('table client_code_corrections', to_regclass('public.client_code_corrections') IS NOT NULL),
  ('table registration_cleanup_settings', to_regclass('public.registration_cleanup_settings') IS NOT NULL),
  ('table registration_cleanup_log', to_regclass('public.registration_cleanup_log') IS NOT NULL),
  -- Counts run as dynamic SQL, so this query also works before 018 or without pg_cron.
  ('two seeded domains', CASE WHEN to_regclass('public.institution_email_domains') IS NULL THEN false
    ELSE (xpath('/row/n/text()', query_to_xml(
      $q$SELECT count(*) = 2 AS n FROM public.institution_email_domains
         WHERE domain IN ('ustavillavo.edu.co', 'ustavillavicencio.edu.co')$q$,
      false, true, '')))[1]::text::boolean END),
  ('trigger on_auth_user_created', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal)),
  ('trigger on_auth_user_confirmed', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_confirmed' AND NOT tgisinternal)),
  ('trigger on_auth_user_email_change', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_email_change' AND NOT tgisinternal)),
  ('trigger trg_users_deactivation', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_deactivation' AND NOT tgisinternal)),
  ('auth triggers enabled', NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
      AND tgname IN ('on_auth_user_created', 'on_auth_user_confirmed', 'on_auth_user_email_change')
      AND tgenabled = 'D')),
  ('create_auth_profile uses the domain rule', COALESCE((
    SELECT prosrc LIKE '%registration_domain_rule%' FROM pg_proc
    WHERE oid = to_regprocedure('public.create_auth_profile()')), false)),
  ('function complete_registration', to_regprocedure('public.complete_registration(text, text, boolean)') IS NOT NULL),
  ('function pending_registration', to_regprocedure('public.pending_registration()') IS NOT NULL),
  ('function purge_unconfirmed_accounts', to_regprocedure('public.purge_unconfirmed_accounts()') IS NOT NULL),
  ('step 2 requires an OTP session after public signup', COALESCE((
    SELECT prosrc LIKE '%REGISTRATION_OTP_SESSION_REQUIRED%' FROM pg_proc
    WHERE oid = to_regprocedure('public.complete_registration(text, text, boolean)')), false)),
  ('cleanup also removes confirmed incomplete accounts', COALESCE((
    SELECT prosrc NOT LIKE '%email_confirmed_at IS NULL%' AND prosrc LIKE '%was_confirmed%'
    FROM pg_proc WHERE oid = to_regprocedure('public.purge_unconfirmed_accounts()')), false)),
  ('cleanup enabled', CASE WHEN to_regclass('public.registration_cleanup_settings') IS NULL THEN false
    ELSE (xpath('/row/n/text()', query_to_xml(
      $q$SELECT bool_and(enabled) AS n FROM public.registration_cleanup_settings$q$,
      false, true, '')))[1]::text::boolean END),
  ('function canonical_institution_email_domain kept', to_regprocedure('public.canonical_institution_email_domain(text)') IS NOT NULL),
  ('CHECK chk_clients_student_code validated', EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_clients_student_code' AND convalidated)),
  ('one cleanup job in cron', CASE WHEN to_regclass('cron.job') IS NULL THEN false
    ELSE (xpath('/row/n/text()', query_to_xml(
      $q$SELECT count(*) = 1 AS n FROM cron.job
         WHERE jobname = 'unifood_purge_unconfirmed_accounts' AND active$q$,
      false, true, '')))[1]::text::boolean END)
)
SELECT object, ok FROM checks ORDER BY object;
