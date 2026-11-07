-- Assigns or releases an institutional code, with an audit record, until the panel exists.
-- An empty new_code releases it and marks a student account as "code under review".
--
-- psql "<connection without password>" -v ON_ERROR_STOP=1 -f scripts/supabase/correct-client-code.sql
--   -v client_id=<clients.id> -v new_code=<digits or empty> -v reason="<reason>" -v actor=<SUPER_ADMIN users.id>
--
-- To hand a code to its real owner, release it first and then assign it in a second run.
BEGIN;
SELECT public.admin_set_client_code(
  :'client_id'::uuid,
  NULLIF(:'new_code', ''),
  :'reason',
  :'actor'::uuid
);
COMMIT;
