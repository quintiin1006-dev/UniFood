BEGIN;

-- Both domains identify the existing Santo Tomas institution. Do not rewrite
-- auth.users.email: codes must still reach the address the student entered.
CREATE OR REPLACE FUNCTION public.canonical_institution_email_domain(email_domain text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE lower(trim(email_domain))
    WHEN 'ustavillavicencio.edu.co' THEN 'ustavillavo.edu.co'
    ELSE lower(trim(email_domain))
  END;
$$;
REVOKE ALL ON FUNCTION public.canonical_institution_email_domain(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_institutional_email(email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE lower(i.email_domain) = public.canonical_institution_email_domain(split_part(trim(email), '@', 2))
      AND i.is_active
      AND length(trim(email)) <= 254
      AND trim(email) ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );
$$;
REVOKE ALL ON FUNCTION public.is_institutional_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;

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
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_auth_profile() FROM PUBLIC, anon, authenticated;

COMMIT;
