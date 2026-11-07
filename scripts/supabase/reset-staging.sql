-- STAGING ONLY. Erases the whole public schema to restart the migrations from 001.
-- It refuses to run if any Auth account exists, which also protects the real project.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Reset refused: this project has Auth accounts.';
  END IF;
END;
$$;

-- CASCADE also removes the triggers that public functions keep on auth.users.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Restore the grants of a new Supabase project.
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

COMMIT;
