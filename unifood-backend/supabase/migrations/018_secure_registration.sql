BEGIN;

-- Registration rules live in data. The browser never chooses the client type:
-- each institutional domain defines it, along with its code requirements.
CREATE TYPE public.client_type AS ENUM ('STUDENT', 'STAFF');

CREATE TABLE public.institution_email_domains (
  domain varchar(253) PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  client_type public.client_type NOT NULL,
  code_required boolean NOT NULL,
  min_code_length smallint NOT NULL,
  max_code_length smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_email_domain_normalized CHECK (domain = lower(btrim(domain))),
  CONSTRAINT chk_email_domain_format CHECK (domain ~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'),
  CONSTRAINT chk_email_domain_code_length
    CHECK (min_code_length BETWEEN 1 AND 32 AND max_code_length BETWEEN min_code_length AND 32)
);
CREATE INDEX idx_institution_email_domains_institution
  ON public.institution_email_domains(institution_id);

DO $$
DECLARE
  institution uuid;
BEGIN
  SELECT id INTO institution FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co';
  IF institution IS NULL THEN
    RAISE EXCEPTION 'Institution for ustavillavo.edu.co is missing';
  END IF;
  INSERT INTO public.institution_email_domains
    (domain, institution_id, client_type, code_required, min_code_length, max_code_length)
  VALUES
    ('ustavillavo.edu.co', institution, 'STUDENT', true, 7, 7),
    ('ustavillavicencio.edu.co', institution, 'STAFF', false, 5, 12);
END;
$$;

ALTER TABLE public.users
  ADD COLUMN email_confirmed_at timestamptz,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients
  ALTER COLUMN document DROP NOT NULL,
  ADD COLUMN client_type public.client_type,
  ADD COLUMN institutional_code varchar(32),
  ADD COLUMN code_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN privacy_accepted_at timestamptz,
  ADD CONSTRAINT chk_clients_code_digits
    CHECK (institutional_code IS NULL OR institutional_code ~ '^[0-9]+$');

CREATE UNIQUE INDEX uq_clients_institution_code
  ON public.clients(institution_id, institutional_code)
  WHERE institutional_code IS NOT NULL;

-- Existing accounts. Documents are a different datum and are never copied to the code.
UPDATE public.users u
  SET email_confirmed_at = a.email_confirmed_at
  FROM auth.users a
  WHERE a.id = u.id;

UPDATE public.clients c
  SET client_type = d.client_type
  FROM public.users u
  JOIN public.institution_email_domains d ON d.domain = split_part(lower(u.email), '@', 2)
  WHERE u.id = c.user_id;

DO $$
DECLARE
  unknown bigint;
BEGIN
  SELECT count(*) INTO unknown FROM public.clients WHERE client_type IS NULL;
  IF unknown > 0 THEN
    RAISE EXCEPTION '% client account(s) use a domain outside institution_email_domains', unknown;
  END IF;
END;
$$;
ALTER TABLE public.clients ALTER COLUMN client_type SET NOT NULL;

-- Students without a code keep working and are resolved by SUPER_ADMIN.
UPDATE public.clients
  SET code_review_required = true
  WHERE client_type = 'STUDENT' AND institutional_code IS NULL;

ALTER TABLE public.clients
  ADD CONSTRAINT chk_clients_student_code CHECK (
    client_type <> 'STUDENT' OR institutional_code IS NOT NULL OR code_review_required
  );

-- Only CLIENT accounts: WORKER and ADMIN activity belongs to cafeteria cardinality.
UPDATE public.users u
  SET is_active = false
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name = 'CLIENT' AND u.is_active AND u.email_confirmed_at IS NULL;

CREATE TABLE public.client_code_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  previous_code varchar(32),
  new_code varchar(32),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_code_correction_reason CHECK (length(btrim(reason)) BETWEEN 5 AND 500)
);
CREATE INDEX idx_client_code_corrections_client ON public.client_code_corrections(client_id);

ALTER TABLE public.institution_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_code_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_email_domains, public.client_code_corrections
  FROM PUBLIC, anon, authenticated;

-- Exact comparison against ASCII input: suffix matches and Unicode lookalikes never pass.
CREATE FUNCTION public.registration_domain_rule(email text)
RETURNS TABLE (
  institution_id uuid,
  client_type public.client_type,
  code_required boolean,
  min_code_length smallint,
  max_code_length smallint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.institution_id, d.client_type, d.code_required, d.min_code_length, d.max_code_length
  FROM public.institution_email_domains d
  JOIN public.institutions i ON i.id = d.institution_id AND i.is_active
  WHERE length(email) <= 254
    AND email ~ '^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$'
    AND d.domain = lower(split_part(email, '@', 2));
$$;
REVOKE ALL ON FUNCTION public.registration_domain_rule(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.valid_institutional_code(code text, min_length smallint, max_length smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT code ~ '^[0-9]+$' AND length(code) BETWEEN min_length AND max_length;
$$;
REVOKE ALL ON FUNCTION public.valid_institutional_code(text, smallint, smallint)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.is_provisioned_identity(app_metadata jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(app_metadata ->> 'unifood_provisioned' = 'true', false);
$$;
REVOKE ALL ON FUNCTION public.is_provisioned_identity(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_institutional_email(email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.registration_domain_rule(email));
$$;
REVOKE ALL ON FUNCTION public.is_institutional_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;

-- Public facts for the form. It never reveals whether a code exists.
CREATE FUNCTION public.registration_rules(email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'allowed', true,
      'clientType', r.client_type,
      'codeRequired', r.code_required,
      'minCodeLength', r.min_code_length,
      'maxCodeLength', r.max_code_length
    ) FROM public.registration_domain_rule(email) r),
    jsonb_build_object('allowed', false)
  );
$$;
REVOKE ALL ON FUNCTION public.registration_rules(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_rules(text) TO anon, authenticated;

-- Every signup passes here. raw_app_meta_data cannot be written from the browser, so
-- only the Admin API can create an identity outside the public registration rule.
CREATE OR REPLACE FUNCTION public.create_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rule record;
  student_name text := btrim(NEW.raw_user_meta_data ->> 'full_name');
  code text := NULLIF(NEW.raw_user_meta_data ->> 'code', '');
BEGIN
  IF public.is_provisioned_identity(NEW.raw_app_meta_data) THEN
    INSERT INTO public.users (id, email, is_active, email_confirmed_at)
      VALUES (NEW.id, lower(NEW.email), false, NEW.email_confirmed_at);
    RETURN NEW;
  END IF;

  SELECT * INTO rule FROM public.registration_domain_rule(NEW.email);
  IF NOT FOUND
    OR student_name IS NULL OR length(student_name) NOT BETWEEN 3 AND 150
    OR (NEW.raw_user_meta_data ->> 'privacy_accepted') IS DISTINCT FROM 'true'
    OR (code IS NULL AND rule.code_required)
    OR (code IS NOT NULL AND NOT public.valid_institutional_code(
      code, rule.min_code_length, rule.max_code_length)) THEN
    RAISE EXCEPTION 'Invalid registration' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.users (id, email, is_active, email_confirmed_at)
    VALUES (NEW.id, lower(NEW.email), false, NEW.email_confirmed_at);
  INSERT INTO public.clients
    (user_id, full_name, institution_id, client_type, institutional_code, privacy_accepted_at)
    VALUES (NEW.id, student_name, rule.institution_id, rule.client_type, code, now());
  INSERT INTO public.user_roles (user_id, role_id)
    SELECT NEW.id, id FROM public.roles WHERE name = 'CLIENT';
  IF NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.users SET is_active = true WHERE id = NEW.id;
  END IF;

  -- The profile holds these now; user metadata travels inside the session JWT.
  UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data
      - ARRAY['full_name', 'code', 'privacy_accepted', 'registration_type', 'document']
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_auth_profile() FROM PUBLIC, anon, authenticated;

-- Runs only on the first confirmation, so an account that SUPER_ADMIN deactivated
-- afterwards stays inactive. Provisioned identities are activated by their own flow.
CREATE FUNCTION public.confirm_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.users u
    SET email_confirmed_at = NEW.email_confirmed_at,
        is_active = u.is_active OR (
          NOT public.is_provisioned_identity(NEW.raw_app_meta_data)
          AND EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = u.id)
        )
    WHERE u.id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_auth_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.confirm_auth_profile();

-- Changing the address would skip the domain rule and keep the old client type.
CREATE FUNCTION public.guard_auth_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(OLD.email) IS DISTINCT FROM lower(NEW.email)
    AND NOT public.is_provisioned_identity(NEW.raw_app_meta_data) THEN
    RAISE EXCEPTION 'Email change is not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_auth_email_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_email_change
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_auth_email_change();

-- Local script only until the SUPER_ADMIN panel exists. Passing NULL releases the code.
CREATE FUNCTION public.admin_set_client_code(
  target_client uuid, new_code text, correction_reason text, actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  client public.clients%ROWTYPE;
  rule public.institution_email_domains%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.id = actor AND u.is_active AND r.name = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'Actor is not an active SUPER_ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO client FROM public.clients WHERE id = target_client FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF new_code IS NOT NULL THEN
    SELECT * INTO rule FROM public.institution_email_domains d
      WHERE d.institution_id = client.institution_id AND d.client_type = client.client_type
      ORDER BY d.domain LIMIT 1;
    IF NOT FOUND OR NOT public.valid_institutional_code(
      new_code, rule.min_code_length, rule.max_code_length) THEN
      RAISE EXCEPTION 'Invalid institutional code' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.clients
    SET institutional_code = new_code,
        code_review_required = new_code IS NULL AND client.client_type = 'STUDENT'
    WHERE id = target_client;
  INSERT INTO public.client_code_corrections (client_id, previous_code, new_code, reason, actor_id)
    VALUES (target_client, client.institutional_code, new_code, correction_reason, actor);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_client_code(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
