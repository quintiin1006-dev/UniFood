BEGIN;

-- Registration does not request a phone number. Keep unknown values as NULL.
ALTER TABLE public.clients ALTER COLUMN phone DROP NOT NULL;

-- The existing self-update RLS policy must not allow changing institutions.
REVOKE UPDATE ON public.clients FROM authenticated;
GRANT UPDATE (full_name, phone) ON public.clients TO authenticated;

-- Only disclose whether a domain is enabled, not institution records.
CREATE OR REPLACE FUNCTION public.is_institutional_email(email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE lower(i.email_domain) = lower(split_part(trim(email), '@', 2))
      AND i.is_active AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  );
$$;
REVOKE ALL ON FUNCTION public.is_institutional_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;

-- Supabase owns credentials, password hashing, verification and token rotation.
-- User-editable metadata must NEVER grant privileged roles.
CREATE OR REPLACE FUNCTION public.create_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  institution uuid;
  student_name text := trim(NEW.raw_user_meta_data ->> 'full_name');
  student_document text := trim(NEW.raw_user_meta_data ->> 'document');
BEGIN
  INSERT INTO public.users (id, email) VALUES (NEW.id, lower(NEW.email));
  IF NEW.raw_user_meta_data ->> 'registration_type' = 'student' THEN
    SELECT id INTO institution FROM public.institutions
      WHERE lower(email_domain) = lower(split_part(NEW.email, '@', 2)) AND is_active;
    IF institution IS NULL OR student_name IS NULL OR length(student_name) NOT BETWEEN 3 AND 150
      OR student_document IS NULL OR student_document !~ '^[A-Za-z0-9-]{5,30}$' THEN
      RAISE EXCEPTION 'Invalid institutional student registration';
    END IF;
    INSERT INTO public.clients (user_id, full_name, document, institution_id)
      VALUES (NEW.id, student_name, student_document, institution);
    INSERT INTO public.user_roles (user_id, role_id)
      SELECT NEW.id, id FROM public.roles WHERE name = 'CLIENT';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_auth_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_auth_profile();

-- Read roles from the database, never from user-editable JWT metadata.
CREATE OR REPLACE FUNCTION public.current_auth_profile()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'email', u.email, 'active', u.is_active,
    'fullName', c.full_name,
    'roles', COALESCE((SELECT jsonb_agg(r.name) FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]'::jsonb)
  ) FROM public.users u LEFT JOIN public.clients c ON c.user_id = u.id
    WHERE u.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.current_auth_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_auth_profile() TO authenticated;

COMMIT;
