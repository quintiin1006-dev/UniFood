BEGIN;
-- No live-data repair: installation holds writers out until the audit and guards exist.
LOCK TABLE public.users, public.user_roles, public.roles, public.cafeteria_users, public.cafeterias IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION public.cafeteria_profile_violations()
RETURNS TABLE(reason text, subject uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'invalid_user_assignment'::text, u.id
  FROM public.users u
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.roles r ON r.id = ur.role_id
  LEFT JOIN public.cafeteria_users cu ON cu.user_id = u.id
  GROUP BY u.id, u.is_active, r.name
  HAVING count(cu.id) > 1
    OR (count(cu.id) > 0 AND (r.name IS NULL OR r.name::text NOT IN ('WORKER','ADMIN')))
    OR (u.is_active AND r.name::text IN ('WORKER','ADMIN') AND count(cu.id) <> 1)
  UNION ALL
  SELECT 'invalid_cafeteria_admin'::text, c.id
  FROM public.cafeterias c
  LEFT JOIN public.cafeteria_users cu ON cu.cafeteria_id = c.id
  LEFT JOIN public.users u ON u.id = cu.user_id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.roles r ON r.id = ur.role_id
  GROUP BY c.id, c.is_active
  HAVING count(*) FILTER (WHERE r.name::text = 'ADMIN') > 1
    OR (c.is_active AND count(*) FILTER (WHERE r.name::text = 'ADMIN' AND u.is_active) <> 1);
$$;
REVOKE ALL ON FUNCTION public.cafeteria_profile_violations() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE violations text;
BEGIN
  SELECT string_agg(reason || ':' || subject::text, ', ') INTO violations
    FROM (SELECT * FROM public.cafeteria_profile_violations() LIMIT 20) v;
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible cafeteria profiles: %. Audit/provision explicitly before migration.', violations
      USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_profile_cardinality';
  END IF;
END;
$$;

ALTER TABLE public.cafeteria_users ADD CONSTRAINT uq_cafeteria_users_user UNIQUE(user_id);

-- Provisioning is infrequent. One statement-level gate deliberately serializes
-- cross-table role/admin/activation changes before the existing per-user row locks.
-- Updating a real tuple also makes stale RR/Serializable writers fail (40001).
-- It does not serialize order/catalog reads or order processing.
CREATE TABLE public.cafeteria_profile_guard (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.cafeteria_profile_guard(id) VALUES (true);
ALTER TABLE public.cafeteria_profile_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cafeteria_profile_guard FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lock_cafeteria_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Use invariant-aware DELETE instead of TRUNCATE'
      USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_profile_cardinality';
  END IF;
  UPDATE public.cafeteria_profile_guard SET revision = revision + 1 WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing cafeteria profile guard'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_cafeteria_profiles() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.check_cafeteria_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cafeteria_profile_violations()) THEN
    RAISE EXCEPTION 'Invalid cafeteria profile: active WORKER/ADMIN require one cafeteria; CLIENT/SUPER_ADMIN require none; active cafeterias require one active ADMIN'
      USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_profile_cardinality';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_cafeteria_profiles() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','user_roles','roles','cafeteria_users','cafeterias'] LOOP
    EXECUTE format('CREATE TRIGGER trg_cafeteria_profiles_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cafeteria_profiles()', table_name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER trg_cafeteria_profiles_check AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_cafeteria_profiles()', table_name);
  END LOOP;
END;
$$;
COMMIT;
