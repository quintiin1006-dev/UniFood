-- Daily menu demo data for unifood-staging ONLY (docs/propuesta-menu-dinamico.md, 2.7).
-- Needs migration 031 and seed-demo.sql («Cafetería Central», «Sede Principal»). Never run it
-- on the real project.
--
-- Run in the SQL Editor of unifood-staging with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
-- The file does not set it itself: without that line the guard stops everything.
--
-- Prices are EXAMPLES only (9.500 the plate; 2.000 and 3.000 the additions). The admin sets
-- the real ones in the panel (PR 9); until then, changes are controlled SQL on staging.
--
-- Safe to run again: existing rows are kept as they are, nothing is updated or deleted, except
-- that today's day is published once if it is still unpublished and a WORKER exists.
BEGIN;

DO $$
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'seed-daily-menu.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF to_regclass('public.daily_menu_settings') IS NULL THEN
    RAISE EXCEPTION 'seed-daily-menu.sql needs migration 031 (daily menu). Apply it first.';
  END IF;
END;
$$;

DO $$
DECLARE
  cafeteria uuid;
  worker uuid;
  today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  SELECT c.id INTO cafeteria
    FROM public.cafeterias c
    JOIN public.sites s ON s.id = c.site_id
    JOIN public.institutions i ON i.id = s.institution_id
    WHERE i.email_domain = 'ustavillavo.edu.co'
      AND s.name = 'Sede Principal' AND c.name = 'Cafetería Central';
  IF cafeteria IS NULL THEN
    RAISE EXCEPTION 'Cafetería Central of Sede Principal is missing; run seed-demo.sql first.';
  END IF;

  -- Plate: title and example fixed price.
  INSERT INTO public.daily_menu_settings (cafeteria_id, title, plate_price)
    VALUES (cafeteria, 'Almuerzo del día', 9500.00)
    ON CONFLICT (cafeteria_id) DO NOTHING;

  -- Fixed template: four single-choice categories and Adiciones. Bebida and Complementos are
  -- skippable («Ninguna»); Complementos is one choice, soup included, no extra cost.
  INSERT INTO public.daily_menu_categories (cafeteria_id, label, kind, position, can_skip)
  SELECT cafeteria, v.label, v.kind, v.position, v.can_skip
  FROM (VALUES
    ('Proteína',        'SINGLE',    0, false),
    ('Principio',       'SINGLE',    1, false),
    ('Bebida',          'SINGLE',    2, true),
    ('Complementos',    'SINGLE',    3, true),
    ('Adiciones',       'ADDITIONS', 4, true)
  ) AS v(label, kind, position, can_skip)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_menu_categories c
    WHERE c.cafeteria_id = cafeteria AND lower(c.label) = lower(v.label));

  -- Example additions (extra price set by the admin later).
  INSERT INTO public.daily_menu_additions (cafeteria_id, name, extra_price)
  SELECT cafeteria, v.name, v.price
  FROM (VALUES ('Huevo frito', 2000.00), ('Queso', 2000.00), ('Chicharrón', 3000.00))
    AS v(name, price)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_menu_additions a
    WHERE a.cafeteria_id = cafeteria AND lower(a.name) = lower(v.name));

  -- Today's demo day (optional path: normally the worker writes and publishes). «Ninguna» is
  -- not stored: it is the absence of a choice in skippable categories.
  INSERT INTO public.daily_menu_days (cafeteria_id, business_date)
    VALUES (cafeteria, today)
    ON CONFLICT (cafeteria_id, business_date) DO NOTHING;

  INSERT INTO public.daily_menu_options (cafeteria_id, business_date, category_id, label)
  SELECT cafeteria, today, c.id, v.label
  FROM (VALUES
    ('Proteína',        'Pollo a la plancha'),
    ('Proteína',        'Carne en salsa'),
    ('Principio',       'Arroz blanco'),
    ('Principio',       'Lentejas'),
    ('Bebida',          'Jugo natural'),
    ('Complementos',    'Sopa de verduras'),
    ('Complementos',    'Fruta de temporada'),
    ('Complementos',    'Postre de la casa')
  ) AS v(cat, label)
  JOIN public.daily_menu_categories c
    ON c.cafeteria_id = cafeteria AND c.label = v.cat AND c.kind = 'SINGLE'
  ON CONFLICT (cafeteria_id, business_date, category_id, label_key) DO NOTHING;

  INSERT INTO public.daily_menu_addition_availability
      (cafeteria_id, business_date, addition_id, is_available, extra_price)
  SELECT a.cafeteria_id, today, a.id, true, a.extra_price
  FROM public.daily_menu_additions a
  WHERE a.cafeteria_id = cafeteria AND a.name IN ('Huevo frito', 'Queso')
  ON CONFLICT (addition_id, business_date) DO NOTHING;

  -- Publish only with an active WORKER of this cafeteria; otherwise leave it unpublished.
  SELECT cu.user_id INTO worker
    FROM public.cafeteria_users cu
    JOIN public.users u ON u.id = cu.user_id AND u.is_active
    JOIN public.user_roles ur ON ur.user_id = cu.user_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE cu.cafeteria_id = cafeteria AND r.name = 'WORKER'
    ORDER BY cu.created_at, cu.user_id
    LIMIT 1;
  IF worker IS NULL THEN
    RAISE NOTICE 'No active WORKER in Cafetería Central: today''s menu stays unpublished.';
  ELSE
    UPDATE public.daily_menu_days dm
      SET title_snapshot = s.title,
          plate_price_snapshot = s.plate_price,
          published_at = now(),
          published_by = worker,
          version = dm.version + 1
      FROM public.daily_menu_settings s
      WHERE s.cafeteria_id = dm.cafeteria_id
        AND dm.cafeteria_id = cafeteria AND dm.business_date = today
        AND dm.published_at IS NULL;
  END IF;
END;
$$;

COMMIT;
