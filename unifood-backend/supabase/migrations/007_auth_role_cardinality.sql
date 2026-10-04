BEGIN;

-- Installation is atomic; prevent writes between the audit and trigger creation.
LOCK TABLE public.users, public.user_roles IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u LEFT JOIN public.user_roles ur ON ur.user_id = u.id
      LEFT JOIN public.roles r ON r.id = ur.role_id
    GROUP BY u.id, u.is_active
    HAVING count(ur.role_id) > 1 OR (u.is_active AND
      count(r.id) FILTER (WHERE r.name::text IN ('CLIENT', 'WORKER', 'ADMIN', 'SUPER_ADMIN')) <> 1)
  ) THEN
    RAISE EXCEPTION 'Incompatible role cardinality; audit and provision explicitly before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'active_user_single_business_role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass AND conname = 'uq_user_roles_user') THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT uq_user_roles_user UNIQUE (user_id);
  END IF;
END;
$$;

-- Use every UUID bit through PostgreSQL's seeded 64-bit text hash, not a UUID
-- prefix, truncation or a 32-bit hash. The namespace separates this invariant.
-- A finite 64-bit hash can collide (approximately 2^-64 per pair); a collision
-- only serializes two users, never weakens validation. No global advisory key.
CREATE OR REPLACE FUNCTION public.auth_role_lock_key(user_id uuid)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT pg_catalog.hashtextextended('unifood:auth-role-cardinality:' || user_id::text, 0);
$$;
REVOKE ALL ON FUNCTION public.auth_role_lock_key(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_auth_role_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected uuid[];
  target uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    affected := ARRAY[NEW.id];
    IF TG_OP = 'UPDATE' THEN affected := affected || OLD.id; END IF;
  ELSE
    affected := ARRAY[]::uuid[];
    IF TG_OP <> 'INSERT' THEN affected := affected || OLD.user_id; END IF;
    IF TG_OP <> 'DELETE' THEN affected := affected || NEW.user_id; END IF;
  END IF;
  FOR target IN SELECT DISTINCT id FROM pg_catalog.unnest(affected) AS ids(id) ORDER BY id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(public.auth_role_lock_key(target));
    IF TG_TABLE_NAME = 'user_roles' THEN
      -- Also write the same parent tuple. At REPEATABLE READ / SERIALIZABLE,
      -- a stale concurrent activity/role writer must abort with 40001 rather
      -- than validate against an old snapshot. No isolation level is changed.
      -- The existing users updated_at trigger also records role changes.
      UPDATE public.users SET is_active = is_active WHERE id = target;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_auth_role_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_auth_role_cardinality()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected uuid[];
  target uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    affected := ARRAY[NEW.id];
    IF TG_OP = 'UPDATE' THEN affected := affected || OLD.id; END IF;
  ELSE
    affected := ARRAY[]::uuid[];
    IF TG_OP <> 'INSERT' THEN affected := affected || OLD.user_id; END IF;
    IF TG_OP <> 'DELETE' THEN affected := affected || NEW.user_id; END IF;
  END IF;
  FOR target IN SELECT DISTINCT id FROM pg_catalog.unnest(affected) AS ids(id) ORDER BY id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(public.auth_role_lock_key(target));
    -- A deleted parent needs no role; allow auth/users cascading deletion.
    IF EXISTS (
      SELECT 1 FROM public.users u WHERE u.id = target AND u.is_active AND
        (SELECT count(*) FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
          WHERE ur.user_id = target
            AND r.name::text IN ('CLIENT', 'WORKER', 'ADMIN', 'SUPER_ADMIN')) <> 1
    ) THEN
      RAISE EXCEPTION 'Active users must have exactly one valid business role'
        USING ERRCODE = '23514', CONSTRAINT = 'active_user_single_business_role';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_auth_role_cardinality() FROM PUBLIC, anon, authenticated;

-- TRUNCATE does not fire row triggers. Use DELETE for invariant-aware removal.
CREATE OR REPLACE FUNCTION public.prevent_auth_roles_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Use DELETE instead of TRUNCATE for user roles'
    USING ERRCODE = '23514', CONSTRAINT = 'active_user_single_business_role';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_auth_roles_truncate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_auth_role_lock ON public.users;
CREATE TRIGGER trg_users_auth_role_lock BEFORE INSERT OR UPDATE OF id, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.lock_auth_role_user();
DROP TRIGGER IF EXISTS trg_user_roles_auth_role_lock ON public.user_roles;
CREATE TRIGGER trg_user_roles_auth_role_lock BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.lock_auth_role_user();

DROP TRIGGER IF EXISTS trg_users_auth_role_cardinality ON public.users;
CREATE CONSTRAINT TRIGGER trg_users_auth_role_cardinality
  AFTER INSERT OR UPDATE OF id, is_active ON public.users DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_auth_role_cardinality();
DROP TRIGGER IF EXISTS trg_user_roles_auth_role_cardinality ON public.user_roles;
CREATE CONSTRAINT TRIGGER trg_user_roles_auth_role_cardinality
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_auth_role_cardinality();
DROP TRIGGER IF EXISTS trg_user_roles_no_truncate ON public.user_roles;
CREATE TRIGGER trg_user_roles_no_truncate BEFORE TRUNCATE ON public.user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_auth_roles_truncate();

CREATE OR REPLACE FUNCTION public.create_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  institution uuid;
  student_name text := trim(NEW.raw_user_meta_data ->> 'full_name');
  student_document text := trim(NEW.raw_user_meta_data ->> 'document');
BEGIN
  -- Non-student identities remain inactive until administrative provisioning.
  INSERT INTO public.users (id, email, is_active) VALUES (NEW.id, lower(NEW.email), false);
  IF NEW.raw_user_meta_data ->> 'registration_type' = 'student' THEN
    SELECT id INTO institution FROM public.institutions
      WHERE lower(email_domain) = public.canonical_institution_email_domain(split_part(NEW.email, '@', 2))
        AND is_active;
    IF institution IS NULL OR NOT public.is_institutional_email(NEW.email)
      OR student_name IS NULL OR length(student_name) NOT BETWEEN 3 AND 150
      OR student_document IS NULL OR student_document !~ '^[A-Za-z0-9-]{5,30}$' THEN
      RAISE EXCEPTION 'Invalid institutional student registration';
    END IF;
    INSERT INTO public.clients (user_id, full_name, document, institution_id)
      VALUES (NEW.id, student_name, student_document, institution);
    INSERT INTO public.user_roles (user_id, role_id)
      SELECT NEW.id, id FROM public.roles WHERE name = 'CLIENT';
    UPDATE public.users SET is_active = true WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_auth_profile() FROM PUBLIC, anon, authenticated;

COMMIT;
