BEGIN;

-- 033: cargo por servicio (docs/modelo-de-negocio.md). A fixed fee in whole pesos per order,
-- paid by the student, collected by the cafeteria at the counter and transferred to UniFood
-- each month. Replaces the per-cafeteria billing agreement of 022, which is kept untouched
-- (no data or column is dropped) and simply stops being read while SERVICE_FEE_ENABLED is on.
--
-- * service_fee_settings: one global row, the general fee (starts at 300).
-- * cafeteria_service_fee: optional per-cafeteria fee; NULL uses the general one, 0 is no fee.
-- * orders.service_fee_cop: immutable snapshot set by the order INSERT; orders.total already
--   includes it, so the product sales of an order are total - service_fee_cop.
-- * service_fee_settlements: the frozen monthly summary per cafeteria (one row per month).
-- * service_fee_audit: append-only history of every fee change, month close and payment.
--
-- The month of a fee is the month of delivered_at in America/Bogota. Only DELIVERED orders
-- count; CANCELLED and NOT_COLLECTED keep their stored fee but are never summed.

-- Ranges shared by the CHECKs and Spring (ServiceFee.MAX_FEE_COP).
CREATE TABLE IF NOT EXISTS public.service_fee_settings (
  id boolean PRIMARY KEY DEFAULT true,
  fee_cop integer NOT NULL,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_service_fee_settings_single CHECK (id),
  CONSTRAINT chk_service_fee_settings_fee CHECK (fee_cop BETWEEN 0 AND 2000),
  CONSTRAINT chk_service_fee_settings_version CHECK (version >= 0)
);

-- The general fee in force from the first day of the pilot.
INSERT INTO public.service_fee_settings (id, fee_cop) VALUES (true, 300)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cafeteria_service_fee (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  fee_cop integer,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cafeteria_service_fee_fee CHECK (fee_cop IS NULL OR fee_cop BETWEEN 0 AND 2000),
  CONSTRAINT chk_cafeteria_service_fee_version CHECK (version >= 0)
);

-- Existing orders have no fee. A constant default does not rewrite the table.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS service_fee_cop integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_service_fee;
ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_service_fee
  CHECK (service_fee_cop BETWEEN 0 AND 2000 AND service_fee_cop <= total);

COMMENT ON COLUMN public.orders.service_fee_cop IS
  'Service fee frozen when the order was created (033). orders.total includes it; product '
  'sales are total - service_fee_cop. Never rewritten.';

CREATE TABLE IF NOT EXISTS public.service_fee_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  period_month date NOT NULL,
  delivered_orders_count integer NOT NULL,
  products_total numeric(14,2) NOT NULL,
  fee_total bigint NOT NULL,
  status text NOT NULL DEFAULT 'PENDIENTE',
  paid_at timestamptz,
  paid_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_fee_settlement_month UNIQUE (cafeteria_id, period_month),
  CONSTRAINT chk_service_fee_settlement_month
    CHECK (period_month = date_trunc('month', period_month::timestamp)::date),
  CONSTRAINT chk_service_fee_settlement_amounts
    CHECK (delivered_orders_count >= 0 AND products_total >= 0 AND fee_total >= 0),
  CONSTRAINT chk_service_fee_settlement_status CHECK (status IN ('PENDIENTE', 'PAGADA')),
  CONSTRAINT chk_service_fee_settlement_paid
    CHECK ((status = 'PAGADA') = (paid_at IS NOT NULL)),
  CONSTRAINT chk_service_fee_settlement_note CHECK (note IS NULL OR char_length(note) <= 200)
);

CREATE TABLE IF NOT EXISTS public.service_fee_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  cafeteria_id uuid REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  period_month date,
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  CONSTRAINT chk_service_fee_audit_action
    CHECK (action IN ('GENERAL_FEE', 'CAFETERIA_FEE', 'MONTH_CLOSED', 'MONTH_PAID')),
  CONSTRAINT chk_service_fee_audit_source CHECK (source IN ('API', 'SQL')),
  CONSTRAINT chk_service_fee_audit_author CHECK ((source = 'API') = (changed_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_service_fee_audit_changed
  ON public.service_fee_audit (changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_service_fee_settlements_month
  ON public.service_fee_settlements (period_month, cafeteria_id);
-- The monthly sum reads DELIVERED orders by (cafeteria_id, delivered_at): it uses
-- idx_orders_delivered_history of 015, so no new index on orders is needed.

-- Who acts: Spring sets unifood.actor_id with SET LOCAL (022's helper); manual SQL leaves it empty.
CREATE OR REPLACE FUNCTION public.service_fee_audit_write(
  p_action text, p_cafeteria uuid, p_month date, p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
BEGIN
  INSERT INTO public.service_fee_audit
    (action, cafeteria_id, period_month, old_value, new_value, changed_by, source)
  VALUES (p_action, p_cafeteria, p_month, p_old, p_new, actor,
          CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END);
END $$;

CREATE OR REPLACE FUNCTION public.audit_service_fee_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.fee_cop IS NOT DISTINCT FROM OLD.fee_cop THEN RETURN NULL; END IF;
  PERFORM public.service_fee_audit_write('GENERAL_FEE', NULL, NULL,
    jsonb_build_object('feeCop', OLD.fee_cop), jsonb_build_object('feeCop', NEW.fee_cop));
  RETURN NULL;
END $$;

-- An INSERT with a NULL fee (the row created before the first change) is not a change.
CREATE OR REPLACE FUNCTION public.audit_cafeteria_service_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous integer := CASE WHEN TG_OP = 'UPDATE' THEN OLD.fee_cop ELSE NULL END;
BEGIN
  IF NEW.fee_cop IS NOT DISTINCT FROM previous THEN RETURN NULL; END IF;
  PERFORM public.service_fee_audit_write('CAFETERIA_FEE', NEW.cafeteria_id, NULL,
    jsonb_build_object('feeCop', previous), jsonb_build_object('feeCop', NEW.fee_cop));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.audit_service_fee_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.service_fee_audit_write('MONTH_CLOSED', NEW.cafeteria_id, NEW.period_month,
      '{}'::jsonb,
      jsonb_build_object('deliveredOrders', NEW.delivered_orders_count,
                         'feeTotal', NEW.fee_total, 'status', NEW.status));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.service_fee_audit_write('MONTH_PAID', NEW.cafeteria_id, NEW.period_month,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status, 'paidAt', NEW.paid_at, 'note', NEW.note));
  END IF;
  RETURN NULL;
END $$;

-- A closed month is frozen: only PENDIENTE -> PAGADA (with its date, author and note) is allowed.
CREATE OR REPLACE FUNCTION public.guard_service_fee_settlement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.status <> 'PENDIENTE'
     OR NEW.status <> 'PAGADA'
     OR NEW.cafeteria_id IS DISTINCT FROM OLD.cafeteria_id
     OR NEW.period_month IS DISTINCT FROM OLD.period_month
     OR NEW.delivered_orders_count IS DISTINCT FROM OLD.delivered_orders_count
     OR NEW.products_total IS DISTINCT FROM OLD.products_total
     OR NEW.fee_total IS DISTINCT FROM OLD.fee_total
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A closed service fee month is frozen'
      USING ERRCODE = '23514', CONSTRAINT = 'service_fee_settlement_frozen';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.reject_service_fee_audit_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Service fee audit is append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'service_fee_audit_immutable';
END $$;

-- The fee of an order is a snapshot: no worker transition, daily close or manual SQL rewrites it.
CREATE OR REPLACE FUNCTION public.reject_order_service_fee_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.service_fee_cop IS DISTINCT FROM OLD.service_fee_cop THEN
    RAISE EXCEPTION 'The service fee of an order is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'orders_service_fee_immutable';
  END IF;
  RETURN NEW;
END $$;

-- Read-only live summary of one cafeteria and month (any day of the month is accepted).
CREATE OR REPLACE FUNCTION public.service_fee_month_summary(p_cafeteria uuid, p_month date)
RETURNS TABLE (delivered_orders_count integer, products_total numeric, fee_total bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT count(*)::integer,
         coalesce(sum(o.total - o.service_fee_cop), 0)::numeric(14,2),
         coalesce(sum(o.service_fee_cop), 0)::bigint
  FROM public.orders o
  WHERE o.cafeteria_id = p_cafeteria
    AND o.status = 'DELIVERED'
    AND o.delivered_at >= (date_trunc('month', p_month::timestamp) AT TIME ZONE 'America/Bogota')
    AND o.delivered_at < ((date_trunc('month', p_month::timestamp) + interval '1 month')
                          AT TIME ZONE 'America/Bogota')
$$;

DROP TRIGGER IF EXISTS trg_service_fee_settings_audit ON public.service_fee_settings;
CREATE TRIGGER trg_service_fee_settings_audit
  AFTER UPDATE ON public.service_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_service_fee_settings();

DROP TRIGGER IF EXISTS trg_service_fee_settings_keep ON public.service_fee_settings;
CREATE TRIGGER trg_service_fee_settings_keep
  BEFORE DELETE ON public.service_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.reject_service_fee_audit_change();

DROP TRIGGER IF EXISTS trg_cafeteria_service_fee_audit ON public.cafeteria_service_fee;
CREATE TRIGGER trg_cafeteria_service_fee_audit
  AFTER INSERT OR UPDATE ON public.cafeteria_service_fee
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_service_fee();

DROP TRIGGER IF EXISTS trg_service_fee_settlement_guard ON public.service_fee_settlements;
CREATE TRIGGER trg_service_fee_settlement_guard
  BEFORE UPDATE OR DELETE ON public.service_fee_settlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_fee_settlement();

DROP TRIGGER IF EXISTS trg_service_fee_settlement_no_truncate ON public.service_fee_settlements;
CREATE TRIGGER trg_service_fee_settlement_no_truncate
  BEFORE TRUNCATE ON public.service_fee_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_service_fee_audit_change();

DROP TRIGGER IF EXISTS trg_service_fee_settlement_audit ON public.service_fee_settlements;
CREATE TRIGGER trg_service_fee_settlement_audit
  AFTER INSERT OR UPDATE ON public.service_fee_settlements
  FOR EACH ROW EXECUTE FUNCTION public.audit_service_fee_settlement();

DROP TRIGGER IF EXISTS trg_service_fee_audit_immutable ON public.service_fee_audit;
CREATE TRIGGER trg_service_fee_audit_immutable
  BEFORE UPDATE OR DELETE ON public.service_fee_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_service_fee_audit_change();

DROP TRIGGER IF EXISTS trg_service_fee_audit_no_truncate ON public.service_fee_audit;
CREATE TRIGGER trg_service_fee_audit_no_truncate
  BEFORE TRUNCATE ON public.service_fee_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_service_fee_audit_change();

DROP TRIGGER IF EXISTS trg_orders_service_fee_immutable ON public.orders;
CREATE TRIGGER trg_orders_service_fee_immutable
  BEFORE UPDATE OF service_fee_cop ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reject_order_service_fee_change();

COMMENT ON TABLE public.service_fee_settings IS
  'General service fee per order in whole pesos (033). One row.';
COMMENT ON TABLE public.cafeteria_service_fee IS
  'Optional fee per cafeteria (033): NULL uses the general fee, 0 means no fee.';
COMMENT ON TABLE public.service_fee_settlements IS
  'Frozen monthly service fee summary per cafeteria (033). PENDIENTE until marked PAGADA.';
COMMENT ON TABLE public.service_fee_audit IS
  'Append-only audit of fee changes, month closes and payments (033), written by trigger.';
COMMENT ON TABLE public.cafeteria_billing_settings IS
  'DEPRECATED by 033 (service fee). Kept with its data and history; not read while '
  'SERVICE_FEE_ENABLED is on.';

-- Business tables stay closed to the browser: only Spring (service connection) reads them.
ALTER TABLE public.service_fee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafeteria_service_fee ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_fee_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_fee_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_fee_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cafeteria_service_fee FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.service_fee_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.service_fee_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.service_fee_settlements_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.service_fee_audit_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_fee_audit_write(text, uuid, date, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_service_fee_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_service_fee() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_service_fee_settlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_service_fee_settlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_service_fee_audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_order_service_fee_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_fee_month_summary(uuid, date)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse (only before any order carries a fee; drops the fee history):
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_orders_service_fee_immutable ON public.orders;
-- DROP TABLE IF EXISTS public.service_fee_audit;
-- DROP TABLE IF EXISTS public.service_fee_settlements;
-- DROP TABLE IF EXISTS public.cafeteria_service_fee;
-- DROP TABLE IF EXISTS public.service_fee_settings;
-- DROP FUNCTION IF EXISTS public.service_fee_month_summary(uuid, date);
-- DROP FUNCTION IF EXISTS public.reject_order_service_fee_change();
-- DROP FUNCTION IF EXISTS public.reject_service_fee_audit_change();
-- DROP FUNCTION IF EXISTS public.guard_service_fee_settlement();
-- DROP FUNCTION IF EXISTS public.audit_service_fee_settlement();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_service_fee();
-- DROP FUNCTION IF EXISTS public.audit_service_fee_settings();
-- DROP FUNCTION IF EXISTS public.service_fee_audit_write(text, uuid, date, jsonb, jsonb);
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_service_fee;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS service_fee_cop;
-- COMMENT ON TABLE public.cafeteria_billing_settings IS
--   'Current billing agreement per cafeteria. Nothing is charged by the system.';
-- COMMIT;
