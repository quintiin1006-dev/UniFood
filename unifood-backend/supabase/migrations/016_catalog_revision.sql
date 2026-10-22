BEGIN;
-- Privileged writes also invalidate every previously issued expected version.
ALTER TABLE public.lunches
  ADD COLUMN version bigint NOT NULL DEFAULT 0 CHECK (version >= 0);
CREATE FUNCTION public.advance_lunch_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 0;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_lunch_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_lunch_version BEFORE INSERT OR UPDATE ON public.lunches
  FOR EACH ROW EXECUTE FUNCTION public.advance_lunch_version();
COMMIT;
