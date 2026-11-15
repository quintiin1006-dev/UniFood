BEGIN;

-- Terms and conditions acceptance (docs/terminos-y-condiciones.md). Registration now stores
-- two separate, explicit acceptances: terms_accepted_at/terms_version here, and the personal
-- data authorization that 018 already stores in privacy_accepted_at.
--
-- The version string is chosen by the web server (CURRENT_TERMS_VERSION in
-- unifood-web/features/auth/legal.ts). The database stores the version it is sent and checks
-- only its shape; it never decides which version is current.
--
-- Existing clients keep both columns NULL: they accept the current version once, after their
-- next login, through accept_client_terms().

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.clients'::regclass AND conname = 'chk_clients_terms_pair'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT chk_clients_terms_pair
      CHECK ((terms_accepted_at IS NULL) = (terms_version IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.clients'::regclass AND conname = 'chk_clients_terms_version_format'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT chk_clients_terms_version_format
      CHECK (terms_version IS NULL OR terms_version ~ '^[A-Za-z0-9._-]{1,32}$');
  END IF;
END;
$$;

COMMENT ON COLUMN public.clients.terms_accepted_at IS
  'When the client accepted the terms and conditions version in terms_version.';
COMMENT ON COLUMN public.clients.terms_version IS
  'Version of the terms and conditions the client accepted, chosen by the web server.';

-- Step 2 of registration, with the acceptance of the terms as a new, required argument. The
-- body is the one of 018; the only changes are the terms check and the stored terms columns.
DROP FUNCTION IF EXISTS public.complete_registration(text, text, boolean);

CREATE FUNCTION public.complete_registration(
  full_name text, institutional_code text, privacy_accepted boolean,
  terms_accepted boolean, terms_version text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := auth.uid();
  pending public.pending_registrations%ROWTYPE;
  confirmed_at timestamptz;
  password_hash text;
  disabled_at timestamptz;
  rule record;
  clean_name text := public.normalized_person_name(full_name);
  code text := NULLIF(btrim(institutional_code), '');
BEGIN
  IF account IS NULL THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_AUTHENTICATED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO pending FROM public.pending_registrations p WHERE p.user_id = account FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_PENDING' USING ERRCODE = 'no_data_found';
  END IF;
  -- Preauthorized accounts are created by the server with a password it chose, so
  -- they may finish from a password session.
  IF NOT pending.preauthorized AND NOT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr'
      @> '[{"method": "otp"}]'::jsonb,
    false
  ) THEN
    RAISE EXCEPTION 'REGISTRATION_OTP_SESSION_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT a.email_confirmed_at, a.encrypted_password INTO confirmed_at, password_hash
    FROM auth.users a WHERE a.id = account;
  SELECT u.deactivated_at INTO disabled_at FROM public.users u WHERE u.id = account FOR UPDATE;
  IF confirmed_at IS NULL THEN
    RAISE EXCEPTION 'REGISTRATION_EMAIL_NOT_CONFIRMED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'REGISTRATION_ACCOUNT_DISABLED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF md5(COALESCE(password_hash, '')) = pending.password_fingerprint THEN
    RAISE EXCEPTION 'REGISTRATION_PASSWORD_CHANGE_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF privacy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'REGISTRATION_PRIVACY_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF terms_accepted IS NOT TRUE
    OR terms_version IS NULL
    OR terms_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
    RAISE EXCEPTION 'REGISTRATION_TERMS_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF clean_name IS NULL THEN
    RAISE EXCEPTION 'REGISTRATION_INVALID_NAME' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO rule FROM public.institution_code_rule(pending.institution_id, pending.client_type);
  IF NOT FOUND
    OR (code IS NULL AND rule.code_required)
    OR (code IS NOT NULL AND NOT public.valid_institutional_code(
      code, rule.min_code_length, rule.max_code_length)) THEN
    RAISE EXCEPTION 'REGISTRATION_INVALID_CODE' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.clients
      (user_id, full_name, institution_id, client_type, institutional_code, privacy_accepted_at,
       terms_accepted_at, terms_version)
      VALUES (account, clean_name, pending.institution_id, pending.client_type, code, now(),
       now(), terms_version);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'REGISTRATION_CODE_UNAVAILABLE' USING ERRCODE = 'unique_violation';
  END;
  INSERT INTO public.user_roles (user_id, role_id)
    SELECT account, r.id FROM public.roles r WHERE r.name = 'CLIENT';
  UPDATE public.users SET is_active = true WHERE id = account;
  DELETE FROM public.pending_registrations WHERE user_id = account;
END;
$$;

-- Whether the caller's client accepted exactly this version. Only the caller's own row.
CREATE FUNCTION public.client_terms_accepted(current_version text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.terms_accepted_at IS NOT NULL
      AND c.terms_version = current_version
  );
$$;

-- Records the acceptance of one terms version by the caller's own client. Accepting again
-- only refreshes the timestamp; a client whose row does not exist cannot accept anything.
CREATE FUNCTION public.accept_client_terms(current_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TERMS_NOT_AUTHENTICATED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_version IS NULL OR current_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
    RAISE EXCEPTION 'TERMS_VERSION_INVALID' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.clients c
    SET terms_accepted_at = now(), terms_version = current_version
    WHERE c.user_id = auth.uid();
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'TERMS_NOT_A_CLIENT' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_registration(text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_terms_accepted(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_client_terms(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_registration(text, text, boolean, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_terms_accepted(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_client_terms(text) TO authenticated;

COMMIT;

-- Reverse (run by hand only if this migration must be undone; it drops the stored acceptances):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.accept_client_terms(text);
-- DROP FUNCTION IF EXISTS public.client_terms_accepted(text);
-- DROP FUNCTION IF EXISTS public.complete_registration(text, text, boolean, boolean, text);
-- CREATE FUNCTION public.complete_registration(
--   full_name text, institutional_code text, privacy_accepted boolean
-- ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
--   -- body as in 018_secure_registration.sql
-- $$;
-- REVOKE ALL ON FUNCTION public.complete_registration(text, text, boolean) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.complete_registration(text, text, boolean) TO authenticated;
-- ALTER TABLE public.clients
--   DROP CONSTRAINT IF EXISTS chk_clients_terms_version_format,
--   DROP CONSTRAINT IF EXISTS chk_clients_terms_pair,
--   DROP COLUMN IF EXISTS terms_version,
--   DROP COLUMN IF EXISTS terms_accepted_at;
-- COMMIT;
