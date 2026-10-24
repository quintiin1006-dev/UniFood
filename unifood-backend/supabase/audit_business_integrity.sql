-- Read-only preflight after 007, usable before/after 008-014. No secrets or data repair.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT 'invalid_user_assignment' AS reason, u.id AS subject,
       u.is_active, r.name AS role, count(cu.id) AS assignments
FROM public.users u
LEFT JOIN public.user_roles ur ON ur.user_id=u.id
LEFT JOIN public.roles r ON r.id=ur.role_id
LEFT JOIN public.cafeteria_users cu ON cu.user_id=u.id
GROUP BY u.id,u.is_active,r.name
HAVING count(cu.id)>1
  OR (count(cu.id)>0 AND (r.name IS NULL OR r.name::text NOT IN ('WORKER','ADMIN')))
  OR (u.is_active AND r.name::text IN ('WORKER','ADMIN') AND count(cu.id)<>1);

SELECT 'invalid_cafeteria_admin' AS reason, c.id AS subject,c.is_active,
       count(*) FILTER(WHERE r.name::text='ADMIN') AS admins,
       count(*) FILTER(WHERE r.name::text='ADMIN' AND u.is_active) AS active_admins
FROM public.cafeterias c
LEFT JOIN public.cafeteria_users cu ON cu.cafeteria_id=c.id
LEFT JOIN public.users u ON u.id=cu.user_id
LEFT JOIN public.user_roles ur ON ur.user_id=u.id
LEFT JOIN public.roles r ON r.id=ur.role_id
GROUP BY c.id,c.is_active
HAVING count(*) FILTER(WHERE r.name::text='ADMIN')>1
  OR (c.is_active AND count(*) FILTER(WHERE r.name::text='ADMIN' AND u.is_active)<>1);

SELECT i.id AS incompatible_item,o.cafeteria_id AS order_cafeteria,
       l.cafeteria_id AS lunch_cafeteria,i.unit_price,i.quantity,i.subtotal
FROM public.order_items i
LEFT JOIN public.orders o ON o.id=i.order_id
LEFT JOIN public.lunches l ON l.id=i.lunch_id
WHERE o.id IS NULL OR l.id IS NULL OR o.cafeteria_id<>l.cafeteria_id
   OR i.subtotal<>i.unit_price*i.quantity;

-- Effective access includes inherited and PUBLIC grants, not just explicit ACL entries.
SELECT actor, c.relname,
       has_table_privilege(actor,c.oid,'SELECT') AS direct_select,
       has_table_privilege(actor,c.oid,'INSERT') AS direct_insert,
       has_table_privilege(actor,c.oid,'UPDATE') AS direct_update,
       has_table_privilege(actor,c.oid,'DELETE') AS direct_delete,
       has_table_privilege(actor,c.oid,'TRUNCATE') AS direct_truncate,
       has_table_privilege(actor,c.oid,'REFERENCES') AS direct_references,
       has_table_privilege(actor,c.oid,'TRIGGER') AS direct_trigger,
       has_any_column_privilege(actor,c.oid,'SELECT') AS column_select,
       has_any_column_privilege(actor,c.oid,'INSERT') AS column_insert,
       has_any_column_privilege(actor,c.oid,'UPDATE') AS column_update,
       has_any_column_privilege(actor,c.oid,'REFERENCES') AS column_references,
       c.relrowsecurity AS rls_enabled
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated')) actors(actor)
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY actor,c.relname;

-- Effective privileges include table, column, PUBLIC and inherited grants.
-- All direct privileges below are unexpected after 010, even if RLS currently blocks rows.
WITH business_tables AS (
  SELECT c.oid,c.relname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY(ARRAY[
    'users','roles','user_roles','clients','institutions','sites','cafeterias','cafeteria_users',
    'lunches','orders','order_items','payments','notifications','notification_preferences','cafeteria_profile_guard',
    'cafeteria_daily_states','daily_item_availability','catalog_image_assets','catalog_image_operations'])
)
SELECT actor,relname AS unexpected_business_table_grant,privilege
FROM business_tables
CROSS JOIN (VALUES ('anon'),('authenticated')) actors(actor)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(privilege)
WHERE has_table_privilege(actor,oid,privilege)
ORDER BY actor,relname,privilege;

SELECT actor,c.relname AS unexpected_business_column_grant,a.attname AS column_name,privilege
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('anon'),('authenticated')) actors(actor)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privileges(privilege)
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY(ARRAY[
  'users','roles','user_roles','clients','institutions','sites','cafeterias','cafeteria_users',
  'lunches','orders','order_items','payments','notifications','notification_preferences','cafeteria_profile_guard',
  'cafeteria_daily_states','daily_item_availability','catalog_image_assets','catalog_image_operations'])
  AND has_column_privilege(actor,c.oid,a.attnum,privilege)
ORDER BY actor,c.relname,a.attnum,privilege;

-- Optional before 014. After 014, the column must be nullable without a default,
-- with a validated state constraint and an enabled BEFORE INSERT/UPDATE row guard.
WITH cancellation_column AS (
  SELECT c.oid AS table_oid,a.attnum,a.attnotnull
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
  WHERE n.nspname='public' AND c.relname='orders'
    AND a.attname='cancelled_at' AND a.attnum>0 AND NOT a.attisdropped
), cancellation_guard AS (
  SELECT oid,prosecdef,proconfig FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('public.guard_order_cancellation_timestamp()')
)
SELECT 'public.orders.cancelled_at' AS cancelled_at_column,
       NOT column_info.attnotnull AS cancelled_at_nullable,
       EXISTS(SELECT 1 FROM pg_catalog.pg_attrdef d
         WHERE d.adrelid=column_info.table_oid AND d.adnum=column_info.attnum) AS cancelled_at_has_default,
       pg_get_constraintdef(state_check.oid) AS cancellation_state_constraint,
       state_check.convalidated AS cancellation_state_constraint_validated,
       guard.oid::regprocedure::text AS cancellation_guard_signature,
       guard.prosecdef AS cancellation_guard_security_definer,
       guard.proconfig AS cancellation_guard_settings,
       trigger_info.tgname AS cancellation_guard_trigger,
       trigger_info.tgtype AS cancellation_guard_trigger_type,
       trigger_info.tgenabled AS cancellation_guard_trigger_enabled,
       trigger_info.tgfoid=guard.oid AS cancellation_guard_trigger_function_matches
FROM cancellation_column column_info
LEFT JOIN pg_catalog.pg_constraint state_check
  ON state_check.conrelid=column_info.table_oid AND state_check.conname='orders_cancelled_at_state'
LEFT JOIN cancellation_guard guard ON true
LEFT JOIN pg_catalog.pg_trigger trigger_info
  ON trigger_info.tgrelid=column_info.table_oid AND trigger_info.tgname='trg_orders_cancelled_at_guard'
  AND NOT trigger_info.tgisinternal;

-- Explicit effective access to the new column, including PUBLIC table/column ACLs.
SELECT actor,'public.orders.cancelled_at' AS cancellation_column,privilege,
       CASE WHEN actor='PUBLIC' THEN EXISTS (
         SELECT 1 FROM (
           SELECT grantee,privilege_type FROM aclexplode(
             CASE WHEN c.relacl IS NULL THEN acldefault('r',c.relowner)
               WHEN cardinality(c.relacl)>0 THEN c.relacl END)
           UNION ALL
           SELECT grantee,privilege_type FROM aclexplode(
             CASE WHEN cardinality(a.attacl)>0 THEN a.attacl END)
         ) permission WHERE permission.grantee=0 AND permission.privilege_type=privilege
       ) ELSE has_column_privilege(actor,c.oid,a.attnum,privilege) END AS unexpected_cancellation_column_privilege
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('PUBLIC'),('anon'),('authenticated')) actors(actor)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privileges(privilege)
WHERE n.nspname='public' AND c.relname='orders' AND a.attname='cancelled_at'
ORDER BY actor,privilege;

SELECT actor,p.oid::regprocedure::text AS cancellation_guard_signature,
       CASE WHEN actor='PUBLIC' THEN EXISTS (
         SELECT 1 FROM aclexplode(
           CASE WHEN p.proacl IS NULL THEN acldefault('f',p.proowner)
             WHEN cardinality(p.proacl)>0 THEN p.proacl END) permission
         WHERE permission.grantee=0 AND permission.privilege_type='EXECUTE'
       ) ELSE has_function_privilege(actor,p.oid,'EXECUTE') END AS unexpected_cancellation_guard_execute
FROM pg_catalog.pg_proc p
CROSS JOIN (VALUES ('PUBLIC'),('anon'),('authenticated')) actors(actor)
WHERE p.oid=to_regprocedure('public.guard_order_cancellation_timestamp()')
ORDER BY actor;

-- The category type is optional before 012. After 012, every reported value
-- must be false: even USAGE without business table access is unexpected here.
-- PUBLIC is a pseudo-role (ACL grantee 0); role checks include inherited grants.
WITH catalog_type AS (
  SELECT t.oid,t.typowner,t.typacl
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typname='catalog_category'
)
SELECT actor,'public.catalog_category' AS type_name,
       CASE WHEN actor='PUBLIC' THEN EXISTS (
         SELECT 1
         FROM aclexplode(COALESCE(t.typacl,acldefault('T',t.typowner))) permission
         WHERE permission.grantee=0 AND permission.privilege_type='USAGE'
       ) ELSE has_type_privilege(actor,t.oid,'USAGE') END AS unexpected_type_usage
FROM catalog_type t
CROSS JOIN (VALUES ('PUBLIC'),('anon'),('authenticated')) actors(actor)
ORDER BY actor;

-- Missing RPCs, missing required EXECUTE and unexpected EXECUTE are all reported.
WITH expected(signature,actor,expected_execute) AS (VALUES
  ('public.is_institutional_email(text)','anon',true),
  ('public.is_institutional_email(text)','authenticated',true),
  ('public.current_auth_profile()','anon',false),
  ('public.current_auth_profile()','authenticated',true)
), actual AS (
  SELECT *,to_regprocedure(signature) AS function_oid FROM expected
)
SELECT signature,actor,expected_execute,function_oid IS NOT NULL AS function_exists,
       CASE WHEN function_oid IS NULL THEN false ELSE has_function_privilege(actor,function_oid,'EXECUTE') END AS can_execute,
       function_oid IS NULL OR expected_execute<>CASE WHEN function_oid IS NULL THEN false ELSE has_function_privilege(actor,function_oid,'EXECUTE') END AS unexpected_rpc_permission
FROM actual ORDER BY signature,actor;

-- Relevant UniFood helpers and unexpected overloads; extensions are not business RPCs.
SELECT actor,p.oid::regprocedure::text AS helper_signature,
       has_function_privilege(actor,p.oid,'EXECUTE') AS unexpected_helper_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN (VALUES ('anon'),('authenticated')) actors(actor)
WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
  'decrease_lunch_stock','set_updated_at','create_auth_profile','canonical_institution_email_domain',
  'auth_role_lock_key','lock_auth_role_user','check_auth_role_cardinality','prevent_auth_roles_truncate',
  'advance_order_version','cafeteria_profile_violations','lock_cafeteria_profiles','check_cafeteria_profiles',
  'derive_order_item_cafeteria','guard_order_cancellation_timestamp','is_institutional_email','current_auth_profile'])
  AND p.oid<>COALESCE(to_regprocedure('public.is_institutional_email(text)')::oid,0::oid)
  AND p.oid<>COALESCE(to_regprocedure('public.current_auth_profile()')::oid,0::oid)
ORDER BY actor,helper_signature;

-- These attributes can bypass row policies; do not inspect password catalogs.
SELECT rolname,rolsuper,rolbypassrls,has_schema_privilege(rolname,'public','USAGE') AS public_schema_usage FROM pg_catalog.pg_roles
WHERE rolname IN ('anon','authenticated') ORDER BY rolname;

SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' ORDER BY tablename,policyname;
COMMIT;
