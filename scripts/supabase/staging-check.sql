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
-- Every foreign key to an account must be checked by purge_unconfirmed_accounts() or be
-- the cascade it relies on. Supabase's own auth tables need ON DELETE CASCADE or SET NULL
-- (auth.scim_users uses SET NULL); public tables get no such exception.
WITH account_fks AS (
  SELECT c.conrelid::regclass::text || '.' || a.attname AS reference,
         c.connamespace = 'auth'::regnamespace AS auth_internal,
         c.confdeltype IN ('c', 'n') AS auth_safe_delete
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.confrelid IN (to_regclass('public.users'), to_regclass('public.clients'), to_regclass('auth.users'))
), uncovered_fks AS (
  SELECT reference FROM account_fks
  WHERE NOT (auth_internal AND auth_safe_delete)
    AND reference NOT IN (
      'users.id', 'clients.user_id', 'user_roles.user_id', 'cafeteria_users.user_id',
      'notifications.user_id', 'notification_preferences.user_id', 'pending_registrations.user_id',
      'client_code_corrections.actor_id', 'client_code_corrections.client_id', 'orders.client_id',
      -- 021: whoever rejects is a WORKER, and the cleanup skips accounts with a role.
      'orders.rejected_by',
      -- 022: only a SUPER_ADMIN changes billing and visibility; the cleanup skips them too.
      'cafeteria_billing_settings.updated_by', 'cafeteria_settings_audit.changed_by')
), checks(object, ok) AS (VALUES
  ('every account foreign key is covered by the cleanup', NOT EXISTS (SELECT 1 FROM uncovered_fks)),
  ('browser roles cannot write account columns', CASE WHEN to_regclass('public.pending_registrations') IS NULL THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r,
        (VALUES ('public.clients', 'client_type'), ('public.clients', 'institutional_code'),
                ('public.clients', 'code_review_required'), ('public.clients', 'privacy_accepted_at'),
                ('public.users', 'is_active'), ('public.users', 'must_change_password'),
                ('public.users', 'deactivated_at')) t(tbl, col)
      WHERE has_table_privilege(r, t.tbl, 'UPDATE') OR has_column_privilege(r, t.tbl, t.col, 'UPDATE')) END),
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

-- Read-only: names the foreign keys behind a false "covered by the cleanup" row.
-- An empty result is expected.
SELECT c.conrelid::regclass::text || '.' || a.attname AS uncovered_account_foreign_key,
       c.confdeltype AS on_delete
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.confrelid IN (to_regclass('public.users'), to_regclass('public.clients'), to_regclass('auth.users'))
  AND NOT (c.connamespace = 'auth'::regnamespace AND c.confdeltype IN ('c', 'n'))
  AND c.conrelid::regclass::text || '.' || a.attname NOT IN (
    'users.id', 'clients.user_id', 'user_roles.user_id', 'cafeteria_users.user_id',
    'notifications.user_id', 'notification_preferences.user_id', 'pending_registrations.user_id',
    'client_code_corrections.actor_id', 'client_code_corrections.client_id', 'orders.client_id',
    -- 021: whoever rejects is a WORKER, and the cleanup skips accounts with a role.
    'orders.rejected_by',
    -- 022: only a SUPER_ADMIN changes billing and visibility; the cleanup skips them too.
    'cafeteria_billing_settings.updated_by', 'cafeteria_settings_audit.changed_by')
ORDER BY 1;

-- Read-only: objects of migration 022 (visibility and billing). Every row must say true.
-- Catalog lookups and dynamic counts only, so it also runs before 022 and reports false.
WITH checks(object, ok) AS (VALUES
  ('022 table cafeteria_billing_settings', to_regclass('public.cafeteria_billing_settings') IS NOT NULL),
  ('022 table cafeteria_settings_audit', to_regclass('public.cafeteria_settings_audit') IS NOT NULL),
  ('022 audit and billing triggers enabled', (
    SELECT count(*) = 7 FROM pg_catalog.pg_trigger
    WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname IN (
      'trg_cafeterias_visibility_audit', 'trg_cafeterias_billing_row', 'trg_cafeteria_billing_audit',
      'trg_cafeteria_billing_required', 'trg_cafeteria_billing_no_truncate',
      'trg_cafeteria_settings_audit_immutable', 'trg_cafeteria_settings_audit_no_truncate'))),
  ('022 every cafeteria has its billing row', CASE
    WHEN to_regclass('public.cafeteria_billing_settings') IS NULL THEN false
    ELSE (xpath('/row/n/text()', query_to_xml(
      $q$SELECT NOT EXISTS (SELECT 1 FROM public.cafeterias c
         WHERE NOT EXISTS (SELECT 1 FROM public.cafeteria_billing_settings b
                           WHERE b.cafeteria_id = c.id)) AS n$q$,
      false, true, '')))[1]::text::boolean END),
  ('022 billing and audit closed to browser roles', CASE
    WHEN to_regclass('public.cafeteria_settings_audit') IS NULL THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r,
        unnest(ARRAY['public.cafeteria_billing_settings', 'public.cafeteria_settings_audit']) t
      WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT')
         OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE')
         OR has_any_column_privilege(r, t, 'SELECT')) END)
)
SELECT object, ok FROM checks ORDER BY object;

-- Read-only: objects of migrations 019-021 (order backend base). Every row must say true.
-- Uses catalog lookups only, so it also runs before 019 and simply reports false.
WITH order_columns AS (
  SELECT attname FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.orders'::regclass AND attnum > 0 AND NOT attisdropped
), checks(object, ok) AS (VALUES
  ('019 catalog_category has BEBIDA', EXISTS (
    SELECT 1 FROM pg_catalog.pg_enum
    WHERE enumtypid = 'public.catalog_category'::regtype AND enumlabel = 'BEBIDA')),
  ('020 orders.idempotency_key and request_hash',
    (SELECT count(*) = 2 FROM order_columns WHERE attname IN ('idempotency_key', 'request_hash'))),
  ('020 unique idempotency key per client', to_regclass('public.uq_orders_client_idempotency_key') IS NOT NULL),
  ('020 one active order per client', COALESCE((
    SELECT i.indisunique AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%PENDING%PREPARING%READY%CALLED%'
    FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.uq_orders_one_active_per_client')), false)),
  ('020 client history index', to_regclass('public.idx_orders_client_history') IS NOT NULL),
  ('021 orders note, cancellation and snapshot columns',
    (SELECT count(*) = 6 FROM order_columns WHERE attname IN (
      'note', 'cancellation_source', 'rejection_reason', 'rejected_by', 'client_code', 'client_type'))),
  ('021 cancellation source trigger enabled', EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.orders'::regclass AND tgname = 'trg_orders_cancellation_source'
      AND NOT tgisinternal AND tgenabled <> 'D')),
  ('021 every cancelled order has a source', CASE
    WHEN NOT EXISTS (SELECT 1 FROM order_columns WHERE attname = 'cancellation_source') THEN false
    ELSE (xpath('/row/n/text()', query_to_xml(
      $q$SELECT NOT EXISTS (SELECT 1 FROM public.orders
         WHERE (status = 'CANCELLED') <> (cancellation_source IS NOT NULL)) AS n$q$,
      false, true, '')))[1]::text::boolean END),
  ('orders closed to browser roles', NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r
    WHERE has_table_privilege(r, 'public.orders', 'SELECT')
       OR has_table_privilege(r, 'public.orders', 'INSERT')
       OR has_table_privilege(r, 'public.orders', 'UPDATE')
       OR has_any_column_privilege(r, 'public.orders', 'SELECT')
       OR has_any_column_privilege(r, 'public.orders', 'UPDATE')))
)
SELECT object, ok FROM checks ORDER BY object;
