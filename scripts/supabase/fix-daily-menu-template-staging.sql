-- One-off fix of the daily menu template on unifood-staging ONLY (docs/propuesta-menu-dinamico.md,
-- decision rev. 7). Never run it on the real project.
--
-- Target template, the same for every cafeteria:
--   0 Proteína (SINGLE, mandatory)   1 Principio (SINGLE, mandatory)
--   2 Bebida (SINGLE, skippable)     3 Complementos (SINGLE, skippable; soup inside, no cost)
--   4 Adiciones (ADDITIONS, always skippable)
--
-- For EVERY cafeteria:
--   - Old template from seed-daily-menu.sql (Acompañamientos and Complemento): Acompañamientos is
--     DEACTIVATED (not deleted: past options reference it), Complemento is renamed Complementos
--     and Bebida is added.
--   - No template at all: the five categories are created.
--   - Anything else: the whole run fails and nothing changes.
-- Every expected UPDATE or INSERT must touch exactly its rows; otherwise RAISE EXCEPTION and the
-- transaction is rolled back. Not repeatable on purpose: a second run fails (already fixed).
--
-- Run in the SQL Editor of unifood-staging with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
-- The last SELECT prints the resulting template per cafeteria.
BEGIN;

DO $$
DECLARE
  cafe record;
  found integer := 0;
  touched integer;
  existing integer;
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'fix-daily-menu-template-staging.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF to_regclass('public.daily_menu_categories') IS NULL THEN
    RAISE EXCEPTION 'Migration 031 (daily menu) is missing.';
  END IF;

  FOR cafe IN SELECT c.id, c.name FROM public.cafeterias c ORDER BY c.name, c.id LOOP
    found := found + 1;
    SELECT count(*) INTO existing
      FROM public.daily_menu_categories WHERE cafeteria_id = cafe.id;

    IF existing = 0 THEN
      INSERT INTO public.daily_menu_categories (cafeteria_id, label, kind, position, can_skip)
      VALUES (cafe.id, 'Proteína', 'SINGLE', 0, false),
             (cafe.id, 'Principio', 'SINGLE', 1, false),
             (cafe.id, 'Bebida', 'SINGLE', 2, true),
             (cafe.id, 'Complementos', 'SINGLE', 3, true),
             (cafe.id, 'Adiciones', 'ADDITIONS', 4, true);
      GET DIAGNOSTICS touched = ROW_COUNT;
      IF touched <> 5 THEN
        RAISE EXCEPTION '%: expected 5 new categories, got %', cafe.name, touched;
      END IF;
      RAISE NOTICE '%: template created', cafe.name;
      CONTINUE;
    END IF;

    -- Old template: exactly the five seeded categories, untouched.
    IF existing <> 5 OR NOT EXISTS (
         SELECT 1 FROM public.daily_menu_categories
         WHERE cafeteria_id = cafe.id AND label = 'Acompañamientos' AND kind = 'SINGLE'
           AND position = 2 AND can_skip AND active)
       OR NOT EXISTS (
         SELECT 1 FROM public.daily_menu_categories
         WHERE cafeteria_id = cafe.id AND label = 'Complemento' AND kind = 'SINGLE'
           AND position = 3 AND can_skip AND active)
       OR EXISTS (
         SELECT 1 FROM public.daily_menu_categories
         WHERE cafeteria_id = cafe.id AND lower(label) IN ('bebida', 'complementos')) THEN
      RAISE EXCEPTION '%: unexpected template (% categories); nothing was changed', cafe.name, existing;
    END IF;

    -- Out of the template and away from the visible positions.
    UPDATE public.daily_menu_categories SET active = false, position = 90, updated_at = now()
      WHERE cafeteria_id = cafe.id AND label = 'Acompañamientos';
    GET DIAGNOSTICS touched = ROW_COUNT;
    IF touched <> 1 THEN
      RAISE EXCEPTION '%: Acompañamientos not deactivated (% rows)', cafe.name, touched;
    END IF;

    UPDATE public.daily_menu_categories SET label = 'Complementos', updated_at = now()
      WHERE cafeteria_id = cafe.id AND label = 'Complemento';
    GET DIAGNOSTICS touched = ROW_COUNT;
    IF touched <> 1 THEN
      RAISE EXCEPTION '%: Complemento not renamed (% rows)', cafe.name, touched;
    END IF;

    INSERT INTO public.daily_menu_categories (cafeteria_id, label, kind, position, can_skip)
      VALUES (cafe.id, 'Bebida', 'SINGLE', 2, true);
    GET DIAGNOSTICS touched = ROW_COUNT;
    IF touched <> 1 THEN
      RAISE EXCEPTION '%: Bebida not created (% rows)', cafe.name, touched;
    END IF;
    RAISE NOTICE '%: template fixed', cafe.name;
  END LOOP;

  IF found = 0 THEN
    RAISE EXCEPTION 'No cafeterias found; nothing was changed';
  END IF;
  RAISE NOTICE '% cafeteria(s) processed', found;
END;
$$;

-- Resulting template, for the person running it to check.
SELECT c.name AS cafeteria, k.position, k.label, k.kind, k.can_skip, k.active
FROM public.daily_menu_categories k
JOIN public.cafeterias c ON c.id = k.cafeteria_id
ORDER BY c.name, k.position;

COMMIT;
