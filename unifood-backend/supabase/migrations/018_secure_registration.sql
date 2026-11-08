BEGIN;

-- Two-step registration (docs/decisiones.md §3):
--   1. Signup: the database only checks the email domain and creates an inactive identity.
--   2. After the OTP: complete_registration() stores name, code and privacy acceptance and
--      activates the account. The code is reserved here, so reserving it needs the mailbox.
-- Identities outside the domain rule need a server-only preauthorization (finding F1).

-- Checks the pg_cron objects this migration uses, so test fixtures can provide them.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL
    OR to_regprocedure('cron.schedule(text, text, text)') IS NULL
    OR to_regprocedure('cron.unschedule(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 018 needs the pg_cron extension. Enable it in Database > Extensions and run 018 again.'
      USING ERRCODE = 'feature_not_supported';
  END IF;
END;
$$;

-- Writers wait until commit, so no account changes between the backfill and the triggers.
LOCK TABLE public.users, public.clients, public.user_roles IN SHARE ROW EXCLUSIVE MODE;

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
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN deactivated_at timestamptz;

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

-- Server-only grants for identities outside the domain rule: WORKER, ADMIN, SUPER_ADMIN
-- and demo clients. Single use and short-lived, because the Admin API inserts the user
-- before it writes app_metadata, so the trigger cannot tell its INSERT from a signup.
CREATE TABLE public.identity_preauthorizations (
  email varchar(254) PRIMARY KEY,
  role_name public.app_role NOT NULL,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  client_type public.client_type,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT session_user,
  CONSTRAINT chk_preauth_email_normalized
    CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  CONSTRAINT chk_preauth_client_scope CHECK (
    (role_name = 'CLIENT') = (institution_id IS NOT NULL AND client_type IS NOT NULL)
    AND (role_name = 'CLIENT' OR (institution_id IS NULL AND client_type IS NULL))
  ),
  CONSTRAINT chk_preauth_lifetime
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);

-- Step 1 done, step 2 pending. password_fingerprint is md5 of the signup password hash.
-- Step 2 requires the stored hash to have changed, that is, the password to have been
-- updated in Auth since signup. bcrypt uses a new salt each time, so the hash changes
-- even if the same password is set again; this proves an update, not a different
-- password. Whoever signed up first with someone else's address loses theirs (F2).
CREATE TABLE public.pending_registrations (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  client_type public.client_type NOT NULL,
  password_fingerprint text NOT NULL,
  preauthorized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pending_registrations_created ON public.pending_registrations(created_at);

-- Append-only audit (finding F9). db_user records who ran it, whatever actor says.
CREATE TABLE public.client_code_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  previous_code varchar(32),
  new_code varchar(32),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  db_user text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_code_correction_reason CHECK (length(btrim(reason)) BETWEEN 5 AND 500)
);
CREATE INDEX idx_client_code_corrections_client ON public.client_code_corrections(client_id);

-- Cleanup of registrations that never finished step 2. One row; pause it with enabled = false.
CREATE TABLE public.registration_cleanup_settings (
  singleton boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  batch_limit integer NOT NULL DEFAULT 100,
  max_age interval NOT NULL DEFAULT interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cleanup_singleton CHECK (singleton),
  CONSTRAINT chk_cleanup_batch_limit CHECK (batch_limit BETWEEN 1 AND 1000),
  CONSTRAINT chk_cleanup_max_age CHECK (max_age >= interval '24 hours')
);
INSERT INTO public.registration_cleanup_settings DEFAULT VALUES;

-- Only the domain is kept, not the address: enough to audit without personal data.
CREATE TABLE public.registration_cleanup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  email_domain text NOT NULL,
  registered_at timestamptz NOT NULL,
  was_confirmed boolean NOT NULL
);

-- Closed to the browser and to the service role: only the database owner writes them.
DO $$
DECLARE
  target text;
  grantee text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'institution_email_domains', 'identity_preauthorizations', 'pending_registrations',
    'client_code_corrections', 'registration_cleanup_settings', 'registration_cleanup_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = grantee) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', target, grantee);
      END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', target);
  END LOOP;
END;
$$;

-- Exact comparison against ASCII input: suffix matches and Unicode lookalikes never pass.
-- The local part rejects "+", spaces, and leading, trailing or repeated dots (F15).
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
    AND email ~ '^[A-Za-z0-9_-]+([.][A-Za-z0-9_-]+)*@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$'
    AND d.domain = lower(split_part(email, '@', 2));
$$;

-- Code rules for an institution and client type, whatever the account's email.
CREATE FUNCTION public.institution_code_rule(institution uuid, kind public.client_type)
RETURNS TABLE (code_required boolean, min_code_length smallint, max_code_length smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.code_required, d.min_code_length, d.max_code_length
  FROM public.institution_email_domains d
  WHERE d.institution_id = institution AND d.client_type = kind
  ORDER BY d.domain
  LIMIT 1;
$$;

CREATE FUNCTION public.valid_institutional_code(code text, min_length smallint, max_length smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT code ~ '^[0-9]+$' AND length(code) BETWEEN min_length AND max_length;
$$;

-- Letters (with Spanish accents), single spaces, apostrophes, dots and hyphens between
-- words. Tabs, invisible or bidirectional characters, markup and digits fail (F10).
CREATE FUNCTION public.normalized_person_name(raw_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN normalized ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+([ ''.-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*[.]?$'
      AND length(normalized) BETWEEN 3 AND 150
    THEN normalized
  END
  FROM (SELECT regexp_replace(btrim(raw_name, ' '), ' {2,}', ' ', 'g') AS normalized) n;
$$;

CREATE OR REPLACE FUNCTION public.is_institutional_email(email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.registration_domain_rule(email));
$$;

-- Public facts for the signup form. It never reveals whether an account or code exists.
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

-- Every new identity passes here. Signup metadata is ignored: name, code and privacy
-- arrive in step 2, so nothing personal is copied from the signup (finding F19).
CREATE OR REPLACE FUNCTION public.create_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  normalized text := lower(NEW.email);
  rule record;
  grant_row public.identity_preauthorizations%ROWTYPE;
BEGIN
  DELETE FROM public.identity_preauthorizations p
    WHERE p.email = normalized AND p.expires_at > now()
    RETURNING * INTO grant_row;
  IF FOUND THEN
    INSERT INTO public.users (id, email, is_active, email_confirmed_at)
      VALUES (NEW.id, normalized, false, NEW.email_confirmed_at);
    -- WORKER, ADMIN and SUPER_ADMIN get their role and activation from their own flow.
    IF grant_row.role_name = 'CLIENT' THEN
      INSERT INTO public.pending_registrations
        (user_id, institution_id, client_type, password_fingerprint, preauthorized)
        VALUES (NEW.id, grant_row.institution_id, grant_row.client_type,
                md5(COALESCE(NEW.encrypted_password, '')), true);
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO rule FROM public.registration_domain_rule(NEW.email);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTRATION_DOMAIN_NOT_ALLOWED' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.users (id, email, is_active, email_confirmed_at)
    VALUES (NEW.id, normalized, false, NEW.email_confirmed_at);
  INSERT INTO public.pending_registrations
    (user_id, institution_id, client_type, password_fingerprint)
    VALUES (NEW.id, rule.institution_id, rule.client_type,
            md5(COALESCE(NEW.encrypted_password, '')));
  RETURN NEW;
END;
$$;

-- Confirmation only records the date. Activation happens in step 2.
CREATE FUNCTION public.confirm_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.users SET email_confirmed_at = NEW.email_confirmed_at WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- No identity changes address: it would skip the domain rule, keep the old client type
-- and leave public.users out of date (finding F7). Recreate the identity instead.
CREATE FUNCTION public.guard_auth_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(OLD.email) IS DISTINCT FROM lower(NEW.email) THEN
    RAISE EXCEPTION 'REGISTRATION_EMAIL_CHANGE_NOT_ALLOWED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A direct deactivation is remembered even on an account that is still inactive, so
-- step 2 cannot reactivate it (finding F6). Role checks of 007 rewrite is_active from
-- inside a trigger; those nested writes are ignored. Clear deactivated_at to undo it.
CREATE FUNCTION public.track_user_deactivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_active THEN
    NEW.deactivated_at := NULL;
  ELSIF OLD.is_active OR pg_catalog.pg_trigger_depth() = 1 THEN
    NEW.deactivated_at := COALESCE(OLD.deactivated_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_code_correction_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- The only allowed change is the FK cascade when a client is deleted.
  IF TG_OP = 'UPDATE' AND NEW.client_id IS NULL
    AND (NEW.id, NEW.previous_code, NEW.new_code, NEW.reason, NEW.actor_id, NEW.db_user, NEW.created_at)
      IS NOT DISTINCT FROM
        (OLD.id, OLD.previous_code, OLD.new_code, OLD.reason, OLD.actor_id, OLD.db_user, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client_code_corrections is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Triggers on auth.users go first: CREATE TRIGGER holds a lock on auth.users until
-- commit, so no confirmation is lost between the backfill and the triggers (F11).
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.confirm_auth_profile();
CREATE TRIGGER on_auth_user_email_change
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_auth_email_change();

-- Existing accounts. Documents are a different datum and are never copied to the code.
UPDATE public.users u
  SET email_confirmed_at = a.email_confirmed_at
  FROM auth.users a
  WHERE a.id = u.id;

UPDATE public.clients c
  SET client_type = d.client_type
  FROM public.users u
  JOIN public.institution_email_domains d ON d.domain = split_part(lower(u.email), '@', 2)
  WHERE u.id = c.user_id AND d.institution_id = c.institution_id;

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

-- Students without a code keep working and are resolved by SUPER_ADMIN. The CHECK
-- below is created validated: every existing row already satisfies it.
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

-- Created after the backfill, so the deactivation above is not recorded as administrative.
CREATE TRIGGER trg_users_deactivation
  BEFORE UPDATE OF is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.track_user_deactivation();
CREATE TRIGGER trg_code_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.client_code_corrections
  FOR EACH ROW EXECUTE FUNCTION public.guard_code_correction_log();
CREATE TRIGGER trg_code_corrections_no_truncate
  BEFORE TRUNCATE ON public.client_code_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_code_correction_log();

-- Step 2, called with the user's own session. After a public signup that session must
-- come from verifying an emailed code (amr "otp"), never from a password login: whoever
-- chose the signup password cannot finish someone else's registration. Auth must already hold an
-- updated password hash; the caller also signs out the other sessions.
CREATE FUNCTION public.complete_registration(
  full_name text, institutional_code text, privacy_accepted boolean
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
      (user_id, full_name, institution_id, client_type, institutional_code, privacy_accepted_at)
      VALUES (account, clean_name, pending.institution_id, pending.client_type, code, now());
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'REGISTRATION_CODE_UNAVAILABLE' USING ERRCODE = 'unique_violation';
  END;
  INSERT INTO public.user_roles (user_id, role_id)
    SELECT account, r.id FROM public.roles r WHERE r.name = 'CLIENT';
  UPDATE public.users SET is_active = true WHERE id = account;
  DELETE FROM public.pending_registrations WHERE user_id = account;
END;
$$;

-- What the step 2 form needs. Only about the caller's own account.
CREATE FUNCTION public.pending_registration()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'pending', true,
      'emailConfirmed', u.email_confirmed_at IS NOT NULL,
      'clientType', p.client_type,
      'codeRequired', r.code_required,
      'minCodeLength', r.min_code_length,
      'maxCodeLength', r.max_code_length
    )
    FROM public.pending_registrations p
    JOIN public.users u ON u.id = p.user_id
    CROSS JOIN LATERAL public.institution_code_rule(p.institution_id, p.client_type) r
    WHERE p.user_id = auth.uid()),
    jsonb_build_object('pending', false)
  );
$$;

-- Local script only until the SUPER_ADMIN panel exists. Passing NULL releases the code.
CREATE FUNCTION public.admin_set_client_code(
  target_client uuid, new_code text, correction_reason text, actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  client public.clients%ROWTYPE;
  rule record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.id = actor AND u.is_active AND u.email_confirmed_at IS NOT NULL
      AND r.name = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'Actor is not an active SUPER_ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO client FROM public.clients WHERE id = target_client FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF new_code IS NOT NULL THEN
    SELECT * INTO rule FROM public.institution_code_rule(client.institution_id, client.client_type);
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

-- SQL Editor only. Lets one address bypass the domain rule for the next 15 minutes by
-- default. A CLIENT needs institution and client type; other roles take neither.
CREATE FUNCTION public.preauthorize_identity(
  email text, role_name public.app_role,
  institution uuid DEFAULT NULL, kind public.client_type DEFAULT NULL,
  valid_for interval DEFAULT interval '15 minutes'
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.identity_preauthorizations
    (email, role_name, institution_id, client_type, expires_at)
  VALUES (lower(btrim(email)), role_name, institution, kind, now() + valid_for)
  ON CONFLICT ON CONSTRAINT identity_preauthorizations_pkey DO UPDATE
    SET role_name = EXCLUDED.role_name,
        institution_id = EXCLUDED.institution_id,
        client_type = EXCLUDED.client_type,
        created_at = now(),
        created_by = session_user,
        expires_at = EXCLUDED.expires_at;
$$;

-- Deletes registrations that never finished step 2 within max_age, confirmed or not,
-- only from public signup or a CLIENT preauthorization, and only when nothing else
-- points at the account. Bounded per run, logged without the address, and paused with
-- enabled = false. A new table referencing users must be added to the checks below.
CREATE FUNCTION public.purge_unconfirmed_accounts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  settings public.registration_cleanup_settings%ROWTYPE;
  purged integer;
BEGIN
  SELECT * INTO settings FROM public.registration_cleanup_settings;
  IF NOT FOUND OR NOT settings.enabled THEN
    RETURN 0;
  END IF;
  DELETE FROM public.identity_preauthorizations WHERE expires_at <= now();

  WITH candidates AS (
    SELECT p.user_id, p.created_at
    FROM public.pending_registrations p
    WHERE p.created_at < now() - settings.max_age
      AND NOT EXISTS (SELECT 1 FROM public.clients x WHERE x.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.cafeteria_users x WHERE x.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.notifications x WHERE x.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.notification_preferences x WHERE x.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.client_code_corrections x WHERE x.actor_id = p.user_id)
    ORDER BY p.created_at
    LIMIT settings.batch_limit
    FOR UPDATE OF p SKIP LOCKED
  ), removed AS (
    DELETE FROM auth.users a
    USING candidates c
    WHERE a.id = c.user_id
    RETURNING a.id, a.email, c.created_at, a.email_confirmed_at IS NOT NULL AS was_confirmed
  )
  INSERT INTO public.registration_cleanup_log
    (user_id, email_domain, registered_at, was_confirmed)
    SELECT id, split_part(lower(email), '@', 2), created_at, was_confirmed FROM removed;
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;

-- Function grants: everything is closed, then the three public entry points reopen.
DO $$
DECLARE
  target text;
  grantee text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.registration_domain_rule(text)',
    'public.institution_code_rule(uuid, public.client_type)',
    'public.valid_institutional_code(text, smallint, smallint)',
    'public.normalized_person_name(text)',
    'public.is_institutional_email(text)',
    'public.registration_rules(text)',
    'public.create_auth_profile()',
    'public.confirm_auth_profile()',
    'public.guard_auth_email_change()',
    'public.track_user_deactivation()',
    'public.guard_code_correction_log()',
    'public.complete_registration(text, text, boolean)',
    'public.pending_registration()',
    'public.admin_set_client_code(uuid, text, text, uuid)',
    'public.preauthorize_identity(text, public.app_role, uuid, public.client_type, interval)',
    'public.purge_unconfirmed_accounts()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', target);
    FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = grantee) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', target, grantee);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registration_rules(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_registration(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_registration() TO authenticated;

-- Hourly cleanup. Unschedule first so running this block again leaves exactly one job.
DO $$
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j
    WHERE j.jobname = 'unifood_purge_unconfirmed_accounts';
  PERFORM cron.schedule(
    'unifood_purge_unconfirmed_accounts', '17 * * * *',
    'SELECT public.purge_unconfirmed_accounts()'
  );
END;
$$;

COMMIT;

-- Reverse, staging only. Deleted accounts and released codes cannot be restored, and
-- accounts created after 018 are left without the old one-step profile. Prefer
-- scripts/supabase/reset-staging.sql followed by migrations 001-017.
--
-- BEGIN;
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'unifood_purge_unconfirmed_accounts';
-- DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
-- DROP TRIGGER IF EXISTS on_auth_user_email_change ON auth.users;
-- DROP TRIGGER IF EXISTS trg_users_deactivation ON public.users;
-- DROP FUNCTION IF EXISTS public.purge_unconfirmed_accounts();
-- DROP FUNCTION IF EXISTS public.preauthorize_identity(text, public.app_role, uuid, public.client_type, interval);
-- DROP FUNCTION IF EXISTS public.admin_set_client_code(uuid, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.pending_registration();
-- DROP FUNCTION IF EXISTS public.complete_registration(text, text, boolean);
-- DROP FUNCTION IF EXISTS public.track_user_deactivation();
-- DROP FUNCTION IF EXISTS public.guard_auth_email_change();
-- DROP FUNCTION IF EXISTS public.confirm_auth_profile();
-- DROP FUNCTION IF EXISTS public.registration_rules(text);
-- DROP TABLE IF EXISTS public.registration_cleanup_log, public.registration_cleanup_settings,
--   public.client_code_corrections, public.pending_registrations,
--   public.identity_preauthorizations;
-- DROP FUNCTION IF EXISTS public.guard_code_correction_log();
-- DROP FUNCTION IF EXISTS public.normalized_person_name(text);
-- DROP FUNCTION IF EXISTS public.valid_institutional_code(text, smallint, smallint);
-- -- Restore the 006 version of is_institutional_email and the 007 version of
-- -- create_auth_profile from their files before dropping the domain rule.
-- DROP FUNCTION IF EXISTS public.institution_code_rule(uuid, public.client_type);
-- DROP FUNCTION IF EXISTS public.registration_domain_rule(text);
-- DROP INDEX IF EXISTS public.uq_clients_institution_code;
-- ALTER TABLE public.clients
--   DROP CONSTRAINT IF EXISTS chk_clients_student_code,
--   DROP CONSTRAINT IF EXISTS chk_clients_code_digits,
--   DROP COLUMN IF EXISTS privacy_accepted_at,
--   DROP COLUMN IF EXISTS code_review_required,
--   DROP COLUMN IF EXISTS institutional_code,
--   DROP COLUMN IF EXISTS client_type;
-- -- clients.document stays nullable: rows without a document may exist by now.
-- ALTER TABLE public.users
--   DROP COLUMN IF EXISTS deactivated_at,
--   DROP COLUMN IF EXISTS must_change_password,
--   DROP COLUMN IF EXISTS email_confirmed_at;
-- DROP TABLE IF EXISTS public.institution_email_domains;
-- DROP TYPE IF EXISTS public.client_type;
-- COMMIT;
