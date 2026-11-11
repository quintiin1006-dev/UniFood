-- Role and activation for one SUPER_ADMIN account in unifood-staging ONLY (demo).
-- Needs migrations 001-021. Never run it on the real project: there, the local script of
-- docs/decisiones.md §10 is still pending.
--
-- Full procedure in docs/decisiones.md, "Cuenta SUPER_ADMIN de staging". Before this script:
-- preauthorize the address and create the identity in Authentication with Auto Confirm.
--
-- Run in the SQL Editor of unifood-staging with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
-- and replace CORREO below with the address. Do not save or commit the real address.
--
-- At most two SUPER_ADMIN accounts (§2, §10): a third is rejected and nothing is applied.
-- SUPER_ADMIN has no cafeteria (migration 009 rejects the assignment).
BEGIN;

-- Holds other role writes until COMMIT, so two runs cannot both pass the limit check.
LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  account_email constant text := lower(btrim('CORREO'));
  target uuid;
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'seed-super-admin.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF (SELECT count(*)
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE r.name = 'SUPER_ADMIN') >= 2 THEN
    RAISE EXCEPTION 'SUPER_ADMIN_LIMIT: there are already two SUPER_ADMIN accounts; a third one is not created.';
  END IF;
  SELECT u.id INTO target FROM public.users u WHERE u.email = account_email;
  IF target IS NULL THEN
    RAISE EXCEPTION 'SUPER_ADMIN_IDENTITY_MISSING: create the identity in Authentication > Users first.';
  END IF;
  INSERT INTO public.user_roles (user_id, role_id)
    SELECT target, r.id FROM public.roles r WHERE r.name = 'SUPER_ADMIN';
  UPDATE public.users SET is_active = true WHERE id = target;
END
$$;

COMMIT;
