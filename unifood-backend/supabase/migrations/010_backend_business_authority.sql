BEGIN;
-- Auth RPCs remain usable; business tables have no browser REST contract.
-- Revoke column grants too: REVOKE at table level alone does NOT remove 005's
-- UPDATE(full_name,phone), nor column privileges added by a platform default.
DO $$
DECLARE target record; columns text; policy record;
BEGIN
  FOR target IN SELECT c.oid, c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname = ANY(ARRAY[
      'users','roles','user_roles','clients','institutions','sites','cafeterias','cafeteria_users',
      'lunches','orders','order_items','payments','notifications','notification_preferences','cafeteria_profile_guard']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target.relname);
    SELECT string_agg(quote_ident(a.attname), ',') INTO columns FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=target.oid AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', columns, target.relname);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.relname);
    FOR policy IN SELECT polname FROM pg_catalog.pg_policy WHERE polrelid=target.oid LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy.polname, target.relname);
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.decrease_lunch_stock(uuid, integer), public.set_updated_at(),
  public.create_auth_profile(), public.canonical_institution_email_domain(text), public.auth_role_lock_key(uuid),
  public.lock_auth_role_user(), public.check_auth_role_cardinality(), public.prevent_auth_roles_truncate(),
  public.cafeteria_profile_violations(), public.lock_cafeteria_profiles(), public.check_cafeteria_profiles(),
  public.is_institutional_email(text), public.current_auth_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_auth_profile() TO authenticated;
-- Defaults apply to objects subsequently created by this migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
COMMIT;
