-- Demo data for unifood-staging ONLY: one site, one cafeteria and eight products.
-- Needs migrations 001-021. Never run it on the real project.
--
-- Run in the SQL Editor of unifood-staging with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
--
-- Safe to run again: existing rows are kept as they are, nothing is updated or deleted.
-- The cafeteria is created INACTIVE (migration 009: an active cafeteria needs its ADMIN).
-- Activate it after creating the ADMIN; see docs/decisiones.md, "Cuentas de la demo".
-- Today's open state and product availability are added for today in America/Bogota
-- only. On any other day the WORKER opens the cafeteria from the panel.
BEGIN;

DO $$
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'seed-demo.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_enum
    WHERE enumtypid = 'public.catalog_category'::regtype AND enumlabel = 'BEBIDA'
  ) THEN
    RAISE EXCEPTION 'seed-demo.sql needs migration 019 (BEBIDA category). Apply 019-021 first.';
  END IF;
END;
$$;

DO $$
DECLARE
  institution uuid;
  site uuid;
  cafeteria uuid;
  today date := (now() AT TIME ZONE 'America/Bogota')::date;
  created_products integer;
BEGIN
  SELECT id INTO institution FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co';
  IF institution IS NULL THEN
    RAISE EXCEPTION 'Institution ustavillavo.edu.co is missing; migrations 001-021 must be applied.';
  END IF;

  INSERT INTO public.sites (name, city, institution_id, is_active)
    VALUES ('Sede Principal', 'Villavicencio', institution, true)
    ON CONFLICT ON CONSTRAINT uq_site_name_per_institution DO NOTHING;
  SELECT id INTO site FROM public.sites
    WHERE institution_id = institution AND name = 'Sede Principal';

  -- Order hours are a legacy NOT NULL column; ordering is gated by the daily open state.
  INSERT INTO public.cafeterias (site_id, name, is_active, lunch_order_start, lunch_order_end)
    VALUES (site, 'Cafetería Central', false, '06:00', '18:00')
    ON CONFLICT ON CONSTRAINT uq_cafeteria_name_per_site DO NOTHING;
  SELECT id INTO cafeteria FROM public.cafeterias
    WHERE site_id = site AND name = 'Cafetería Central';

  INSERT INTO public.lunches (cafeteria_id, name, description, price, category, is_active)
  SELECT cafeteria, p.name, p.description, p.price, p.category::public.catalog_category, true
  FROM (VALUES
    ('Calentado con huevo', 'Arroz y fríjol calentados, huevo y arepa.', 9500, 'DESAYUNO'),
    ('Arepa con queso y chocolate', 'Arepa asada con queso y una taza de chocolate.', 7000, 'DESAYUNO'),
    ('Corriente del día', 'Sopa, arroz, principio, proteína del día y ensalada.', 13000, 'CORRIENTE'),
    ('Corriente con pechuga', 'Sopa, arroz, principio, pechuga a la plancha y ensalada.', 14500, 'CORRIENTE'),
    ('Ejecutivo de res', 'Carne de res, arroz, papa, ensalada y bebida.', 19000, 'EJECUTIVO'),
    ('Ejecutivo de pescado', 'Filete de pescado, arroz con coco, patacón y ensalada.', 21000, 'EJECUTIVO'),
    ('Jugo natural', 'Jugo de fruta del día en agua o en leche.', 4500, 'BEBIDA'),
    ('Gaseosa 400 ml', 'Gaseosa personal de 400 ml.', 3500, 'BEBIDA')
  ) AS p(name, description, price, category)
  ON CONFLICT ON CONSTRAINT uq_lunch_name_per_cafeteria DO NOTHING;
  GET DIAGNOSTICS created_products = ROW_COUNT;

  -- Open today and every product available today. An existing choice for today is kept.
  INSERT INTO public.cafeteria_daily_states (cafeteria_id, business_date, is_open)
    VALUES (cafeteria, today, true)
    ON CONFLICT (cafeteria_id, business_date) DO NOTHING;
  INSERT INTO public.daily_item_availability (cafeteria_id, item_id, business_date, is_available)
    SELECT cafeteria, l.id, today, true FROM public.lunches l
    WHERE l.cafeteria_id = cafeteria AND l.is_active
    ON CONFLICT (item_id, business_date) DO NOTHING;

  RAISE NOTICE 'Demo seed: cafeteria %, % new product(s), business date %.',
    cafeteria, created_products, today;
END;
$$;

COMMIT;
