-- Service fee demo data for unifood-staging ONLY (docs/modelo-de-negocio.md). Needs migration
-- 033 and seed-demo.sql («Cafetería Central», «Sede Principal», with active products). Never run
-- it on the real project.
--
-- Run in the SQL Editor of unifood-staging with this line first, in the same run:
--   SET unifood.seed_target = 'staging';
-- The file does not set it itself: without that line the guard stops everything.
--
-- What it leaves, relative to the current month M in America/Bogota:
--   * General fee 300 (changed only if it is something else; audited as manual SQL).
--   * M:   6 DELIVERED orders with fee 300, plus 1 CANCELLED and 1 NOT_COLLECTED that do not
--          count. Live, «ABIERTO».
--   * M-1: 5 DELIVERED orders, not closed: «ABIERTO» and ready for «Cerrar mes».
--   * M-2: 4 DELIVERED orders, closed and PENDIENTE: always «Vencido» (rule 9).
--   * M-3: 3 DELIVERED orders, closed and PAGADA.
-- Orders have no client account (client_id NULL), a fixed name and one product line each.
--
-- Safe to run again: ids are deterministic and every insert is ON CONFLICT DO NOTHING; a closed
-- month is never recalculated and a PAGADA one is never touched.
BEGIN;

DO $$
BEGIN
  IF current_setting('unifood.seed_target', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'seed-cargo-servicio-staging.sql is for unifood-staging only. Run "SET unifood.seed_target = ''staging'';" first, in the same run.';
  END IF;
  IF to_regclass('public.service_fee_settlements') IS NULL THEN
    RAISE EXCEPTION 'seed-cargo-servicio-staging.sql needs migration 033 (service fee). Apply it first.';
  END IF;
END;
$$;

DO $$
DECLARE
  cafeteria uuid;
  product record;
  fee constant integer := 300;
  now_bogota timestamp := now() AT TIME ZONE 'America/Bogota';
  month_m date := date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date;
  months date[];
  counts integer[] := ARRAY[6, 5, 4, 3];
  k integer;
  n integer;
  local_at timestamp;
  delivered timestamptz;
  order_id uuid;
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
  SELECT l.id, l.name, l.price INTO product
    FROM public.lunches l
    WHERE l.cafeteria_id = cafeteria AND l.is_active AND l.price > 0
    ORDER BY l.name, l.id
    LIMIT 1;
  IF product.id IS NULL THEN
    RAISE EXCEPTION 'Cafetería Central has no active product; run seed-demo.sql first.';
  END IF;

  UPDATE public.service_fee_settings SET fee_cop = fee, version = version + 1, updated_at = now()
    WHERE id AND fee_cop <> fee;

  months := ARRAY[month_m, (month_m - interval '1 month')::date,
                  (month_m - interval '2 months')::date, (month_m - interval '3 months')::date];

  FOR k IN 1..4 LOOP
    FOR n IN 1..counts[k] LOOP
      -- Day n of the month at 12:00 Bogota; in the current month never after now.
      local_at := months[k] + make_interval(days => n - 1, hours => 12);
      IF k = 1 AND local_at > now_bogota - interval '1 hour' THEN
        local_at := greatest(months[k]::timestamp, now_bogota - interval '1 hour');
      END IF;
      delivered := local_at AT TIME ZONE 'America/Bogota';
      order_id := md5('unifood-seed-cargo-servicio-' || months[k] || '-' || n)::uuid;
      INSERT INTO public.orders
        (id, cafeteria_id, client_id, client_name, status, total, service_fee_cop,
         created_at, called_at, delivered_at)
      VALUES (order_id, cafeteria, NULL, 'Estudiante de ejemplo', 'DELIVERED',
              product.price + fee, fee, delivered - interval '20 minutes',
              delivered - interval '5 minutes', delivered)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.order_items
        (id, order_id, cafeteria_id, lunch_id, lunch_name, unit_price, quantity, subtotal)
      VALUES (md5('unifood-seed-cargo-servicio-item-' || order_id)::uuid, order_id, cafeteria,
              product.id, product.name, product.price, 1, product.price)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- Current month: one cancelled and one not collected; they keep their fee and never count.
  delivered := greatest(month_m::timestamp, now_bogota - interval '2 hours')
               AT TIME ZONE 'America/Bogota';
  INSERT INTO public.orders
    (id, cafeteria_id, client_id, client_name, status, total, service_fee_cop, created_at)
  VALUES (md5('unifood-seed-cargo-servicio-cancelled-' || month_m)::uuid, cafeteria, NULL,
          'Estudiante de ejemplo', 'PENDING', product.price + fee, fee, delivered),
         (md5('unifood-seed-cargo-servicio-not-collected-' || month_m)::uuid, cafeteria, NULL,
          'Estudiante de ejemplo', 'PENDING', product.price + fee, fee, delivered)
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.orders
    SET status = 'CANCELLED', cancelled_at = delivered + interval '5 minutes',
        cancellation_source = 'CLIENT'
    WHERE id = md5('unifood-seed-cargo-servicio-cancelled-' || month_m)::uuid
      AND status = 'PENDING';
  UPDATE public.orders
    SET status = 'NOT_COLLECTED', called_at = delivered + interval '5 minutes',
        not_collected_at = delivered + interval '30 minutes'
    WHERE id = md5('unifood-seed-cargo-servicio-not-collected-' || month_m)::uuid
      AND status = 'PENDING';

  -- M-2 closed and PENDIENTE (overdue), M-3 closed and PAGADA. Closing twice inserts nothing.
  FOR k IN 3..4 LOOP
    INSERT INTO public.service_fee_settlements
      (cafeteria_id, period_month, delivered_orders_count, products_total, fee_total)
    SELECT cafeteria, months[k], s.delivered_orders_count, s.products_total, s.fee_total
    FROM public.service_fee_month_summary(cafeteria, months[k]) s
    ON CONFLICT (cafeteria_id, period_month) DO NOTHING;
  END LOOP;
  UPDATE public.service_fee_settlements
    SET status = 'PAGADA', paid_at = now(), note = 'Pago de ejemplo (seed de staging)'
    WHERE cafeteria_id = cafeteria AND period_month = months[4] AND status = 'PENDIENTE';
END;
$$;

COMMIT;

-- Check:
--   SELECT period_month, delivered_orders_count, fee_total, status, paid_at
--   FROM public.service_fee_settlements ORDER BY period_month DESC;
