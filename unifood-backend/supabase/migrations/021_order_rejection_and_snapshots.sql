BEGIN;

-- One note per order, who ended a cancelled order and why, and a copy of the client's
-- code and type taken when the order is created (docs/decisiones.md §6 and §10). The
-- worker reads these instead of the client's document. Schema only; Spring uses it later.

LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS cancellation_source text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS client_code varchar(32),
  ADD COLUMN IF NOT EXISTS client_type public.client_type;

-- Existing cancellations: the 008 flag already says exactly who cancelled. Nothing else
-- is inferred; existing orders keep client_code and client_type NULL (history intact).
UPDATE public.orders
  SET cancellation_source = CASE WHEN cancelled_by_client THEN 'CLIENT' ELSE 'WORKER' END
  WHERE status = 'CANCELLED' AND cancellation_source IS NULL;

-- CLIENT: the client cancelled while PENDING. WORKER: the cafeteria ended it; with a
-- rejection_reason it is a rejection, without one it is a cancellation from before the
-- rejection flow. SYSTEM: the daily close.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_note,
  DROP CONSTRAINT IF EXISTS chk_orders_cancellation_source,
  DROP CONSTRAINT IF EXISTS chk_orders_cancellation_source_state,
  DROP CONSTRAINT IF EXISTS chk_orders_cancelled_by_client_source,
  DROP CONSTRAINT IF EXISTS chk_orders_rejection,
  DROP CONSTRAINT IF EXISTS chk_orders_client_code_digits,
  ADD CONSTRAINT chk_orders_note
    CHECK (note IS NULL OR (note = btrim(note) AND length(note) BETWEEN 1 AND 200)),
  ADD CONSTRAINT chk_orders_cancellation_source
    CHECK (cancellation_source IS NULL OR cancellation_source IN ('CLIENT', 'WORKER', 'SYSTEM')),
  ADD CONSTRAINT chk_orders_cancellation_source_state
    CHECK ((status = 'CANCELLED') = (cancellation_source IS NOT NULL)),
  ADD CONSTRAINT chk_orders_cancelled_by_client_source
    CHECK (cancelled_by_client = (cancellation_source IS NOT DISTINCT FROM 'CLIENT')),
  ADD CONSTRAINT chk_orders_rejection
    CHECK (
      (rejection_reason IS NULL) = (rejected_by IS NULL)
      AND (rejection_reason IS NULL OR (
        cancellation_source = 'WORKER'
        AND rejection_reason = btrim(rejection_reason)
        AND length(rejection_reason) BETWEEN 3 AND 300
      ))
    ),
  ADD CONSTRAINT chk_orders_client_code_digits
    CHECK (client_code IS NULL OR client_code ~ '^[0-9]+$');

-- Today Spring only sets cancelled_by_client. This keeps both columns in step for any
-- writer, and makes who ended an order and why impossible to rewrite afterwards.
CREATE OR REPLACE FUNCTION public.sync_order_cancellation_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'CANCELLED' THEN
    IF NEW.cancellation_source IS NULL THEN
      NEW.cancellation_source := CASE WHEN NEW.cancelled_by_client THEN 'CLIENT' ELSE 'WORKER' END;
    END IF;
    NEW.cancelled_by_client := NEW.cancellation_source = 'CLIENT';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.cancellation_source IS NOT NULL
      AND NEW.cancellation_source IS DISTINCT FROM OLD.cancellation_source)
    OR (OLD.rejection_reason IS NOT NULL
      AND NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason)
    OR (OLD.rejected_by IS NOT NULL AND NEW.rejected_by IS DISTINCT FROM OLD.rejected_by)
  ) THEN
    RAISE EXCEPTION 'Order cancellation details are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'orders_cancellation_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_order_cancellation_source() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_cancellation_source ON public.orders;
CREATE TRIGGER trg_orders_cancellation_source BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_cancellation_source();

-- Worker rejections by person, for the audit and the account cleanup check of 018.
CREATE INDEX IF NOT EXISTS idx_orders_rejected_by
  ON public.orders(rejected_by) WHERE rejected_by IS NOT NULL;

-- New columns inherit the table's closed grants from 010; nothing is opened here.
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse:
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_orders_cancellation_source ON public.orders;
-- DROP FUNCTION IF EXISTS public.sync_order_cancellation_source();
-- DROP INDEX IF EXISTS public.idx_orders_rejected_by;
-- ALTER TABLE public.orders
--   DROP CONSTRAINT IF EXISTS chk_orders_client_code_digits,
--   DROP CONSTRAINT IF EXISTS chk_orders_rejection,
--   DROP CONSTRAINT IF EXISTS chk_orders_cancelled_by_client_source,
--   DROP CONSTRAINT IF EXISTS chk_orders_cancellation_source_state,
--   DROP CONSTRAINT IF EXISTS chk_orders_cancellation_source,
--   DROP CONSTRAINT IF EXISTS chk_orders_note,
--   DROP COLUMN IF EXISTS client_type,
--   DROP COLUMN IF EXISTS client_code,
--   DROP COLUMN IF EXISTS rejected_by,
--   DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS cancellation_source,
--   DROP COLUMN IF EXISTS note;
-- COMMIT;
