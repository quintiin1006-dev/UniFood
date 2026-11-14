BEGIN;

-- Separates the two concepts mixed in cafeterias.is_active (docs/decisiones.md §5):
-- is_active stays the operational visibility (and the 009 ADMIN invariant), and the billing
-- model moves to its own table. Nothing is charged in the system: the table only records the
-- agreement. Every change of either is audited by trigger in the same transaction, also when
-- it is made with manual SQL (source 'SQL', no author).
--
-- Applied after 023 (022 was reserved): apply-migrations.ps1 -AllowOutOfOrder 022.

-- No cafeteria may be created between the seed and the trigger that gives it its row.
LOCK TABLE public.cafeterias IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.cafeteria_billing_settings (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  billing_model text NOT NULL DEFAULT 'NONE',
  per_order_fee_cop integer,
  subscription_fee_cop integer,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cafeteria_billing_model
    CHECK (billing_model IN ('NONE', 'SUBSCRIPTION', 'PER_ORDER_FEE')),
  -- Whole pesos. The per-order fee is mandatory with PER_ORDER_FEE and forbidden otherwise.
  CONSTRAINT chk_cafeteria_billing_fee
    CHECK ((billing_model = 'PER_ORDER_FEE') = (per_order_fee_cop IS NOT NULL)
           AND (per_order_fee_cop IS NULL OR per_order_fee_cop BETWEEN 1 AND 1000000)),
  -- The monthly subscription amount is optional, and only SUBSCRIPTION may carry it.
  CONSTRAINT chk_cafeteria_billing_subscription_fee
    CHECK (subscription_fee_cop IS NULL
           OR (billing_model = 'SUBSCRIPTION' AND subscription_fee_cop BETWEEN 1 AND 100000000)),
  CONSTRAINT chk_cafeteria_billing_version CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS public.cafeteria_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  setting text NOT NULL CHECK (setting IN ('VISIBILITY', 'BILLING')),
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('API', 'SQL')),
  CONSTRAINT chk_cafeteria_settings_audit_author CHECK ((source = 'API') = (changed_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cafeteria_settings_audit_cafeteria
  ON public.cafeteria_settings_audit (cafeteria_id, changed_at DESC, id DESC);

-- Every existing cafeteria starts without billing; its visibility (is_active) is untouched.
INSERT INTO public.cafeteria_billing_settings (cafeteria_id)
SELECT c.id FROM public.cafeterias c
ON CONFLICT (cafeteria_id) DO NOTHING;

-- Spring sets unifood.actor_id with SET LOCAL; manual SQL leaves it empty.
CREATE OR REPLACE FUNCTION public.cafeteria_settings_actor()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(current_setting('unifood.actor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.cafeteria_billing_value(
  model text, per_order_fee integer, subscription_fee integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('model', model, 'perOrderFeeCop', per_order_fee,
                            'subscriptionFeeCop', subscription_fee)
$$;

CREATE OR REPLACE FUNCTION public.audit_cafeteria_visibility()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO public.cafeteria_settings_audit
      (cafeteria_id, setting, old_value, new_value, changed_by, source)
    VALUES (NEW.id, 'VISIBILITY',
            jsonb_build_object('visible', OLD.is_active),
            jsonb_build_object('visible', NEW.is_active),
            actor, CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.audit_cafeteria_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.billing_model IS NOT DISTINCT FROM OLD.billing_model
     AND NEW.per_order_fee_cop IS NOT DISTINCT FROM OLD.per_order_fee_cop
     AND NEW.subscription_fee_cop IS NOT DISTINCT FROM OLD.subscription_fee_cop THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cafeteria_settings_audit
    (cafeteria_id, setting, old_value, new_value, changed_by, source)
  VALUES (NEW.cafeteria_id, 'BILLING',
          CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
               ELSE public.cafeteria_billing_value(
                 OLD.billing_model, OLD.per_order_fee_cop, OLD.subscription_fee_cop) END,
          public.cafeteria_billing_value(
            NEW.billing_model, NEW.per_order_fee_cop, NEW.subscription_fee_cop),
          actor, CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.reject_cafeteria_settings_audit_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Cafeteria settings audit is append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_settings_audit_immutable';
END $$;

-- A cafeteria's billing row is never deleted: it lives as long as the cafeteria, which the
-- RESTRICT foreign keys of 022 keep from being deleted while it has rows here.
CREATE OR REPLACE FUNCTION public.reject_cafeteria_billing_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Every cafeteria keeps its billing settings row'
    USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_billing_settings_required';
END $$;

-- A new cafeteria always gets its billing row (NONE), audited like any other change.
CREATE OR REPLACE FUNCTION public.create_cafeteria_billing_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.cafeteria_billing_settings (cafeteria_id) VALUES (NEW.id)
  ON CONFLICT (cafeteria_id) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cafeterias_visibility_audit ON public.cafeterias;
CREATE TRIGGER trg_cafeterias_visibility_audit
  AFTER UPDATE OF is_active ON public.cafeterias
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_visibility();

DROP TRIGGER IF EXISTS trg_cafeterias_billing_row ON public.cafeterias;
CREATE TRIGGER trg_cafeterias_billing_row
  AFTER INSERT ON public.cafeterias
  FOR EACH ROW EXECUTE FUNCTION public.create_cafeteria_billing_settings();

DROP TRIGGER IF EXISTS trg_cafeteria_billing_audit ON public.cafeteria_billing_settings;
CREATE TRIGGER trg_cafeteria_billing_audit
  AFTER INSERT OR UPDATE ON public.cafeteria_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_billing();

DROP TRIGGER IF EXISTS trg_cafeteria_billing_required ON public.cafeteria_billing_settings;
CREATE TRIGGER trg_cafeteria_billing_required
  BEFORE DELETE ON public.cafeteria_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.reject_cafeteria_billing_delete();

DROP TRIGGER IF EXISTS trg_cafeteria_billing_no_truncate ON public.cafeteria_billing_settings;
CREATE TRIGGER trg_cafeteria_billing_no_truncate
  BEFORE TRUNCATE ON public.cafeteria_billing_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cafeteria_billing_delete();

-- Neither UPDATE, DELETE nor TRUNCATE (not even by the owner) rewrites the history.
DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_immutable ON public.cafeteria_settings_audit;
CREATE TRIGGER trg_cafeteria_settings_audit_immutable
  BEFORE UPDATE OR DELETE ON public.cafeteria_settings_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_cafeteria_settings_audit_change();

DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_no_truncate ON public.cafeteria_settings_audit;
CREATE TRIGGER trg_cafeteria_settings_audit_no_truncate
  BEFORE TRUNCATE ON public.cafeteria_settings_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cafeteria_settings_audit_change();

COMMENT ON COLUMN public.cafeterias.is_active IS
  'Operational visibility: visible to clients and accepting new orders (decisiones §5). '
  'Also the 009 administrative activity that requires exactly one active ADMIN.';
COMMENT ON TABLE public.cafeteria_billing_settings IS
  'Current billing agreement per cafeteria. Nothing is charged by the system.';
COMMENT ON TABLE public.cafeteria_settings_audit IS
  'Append-only audit of visibility and billing changes, written by trigger.';

-- Business tables stay closed to the browser: only Spring (service connection) reads them.
ALTER TABLE public.cafeteria_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafeteria_settings_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cafeteria_billing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cafeteria_settings_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cafeteria_settings_audit_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafeteria_settings_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafeteria_billing_value(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_visibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_billing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cafeteria_settings_audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cafeteria_billing_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cafeteria_billing_settings() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse:
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_no_truncate ON public.cafeteria_settings_audit;
-- DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_immutable ON public.cafeteria_settings_audit;
-- DROP TRIGGER IF EXISTS trg_cafeteria_billing_no_truncate ON public.cafeteria_billing_settings;
-- DROP TRIGGER IF EXISTS trg_cafeteria_billing_required ON public.cafeteria_billing_settings;
-- DROP TRIGGER IF EXISTS trg_cafeteria_billing_audit ON public.cafeteria_billing_settings;
-- DROP TRIGGER IF EXISTS trg_cafeterias_billing_row ON public.cafeterias;
-- DROP TRIGGER IF EXISTS trg_cafeterias_visibility_audit ON public.cafeterias;
-- DROP FUNCTION IF EXISTS public.create_cafeteria_billing_settings();
-- DROP FUNCTION IF EXISTS public.reject_cafeteria_billing_delete();
-- DROP FUNCTION IF EXISTS public.reject_cafeteria_settings_audit_change();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_billing();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_visibility();
-- DROP FUNCTION IF EXISTS public.cafeteria_billing_value(text, integer, integer);
-- DROP FUNCTION IF EXISTS public.cafeteria_settings_actor();
-- DROP TABLE IF EXISTS public.cafeteria_settings_audit;   -- deletes the audit history
-- DROP TABLE IF EXISTS public.cafeteria_billing_settings;
-- COMMENT ON COLUMN public.cafeterias.is_active IS NULL;
-- COMMIT;
