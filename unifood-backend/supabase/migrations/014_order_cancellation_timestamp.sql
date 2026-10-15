BEGIN;

-- Existing terminal timestamps remain unknown; never infer them from other dates.
ALTER TABLE public.orders
  ADD COLUMN cancelled_at timestamptz NULL,
  ADD CONSTRAINT orders_cancelled_at_state
    CHECK (cancelled_at IS NULL OR status = 'CANCELLED');

-- Spring supplies TimeProvider's instant in the same write as the cancellation.
-- This guard validates metadata; it never generates dates or changes versions.
CREATE FUNCTION public.guard_order_cancellation_timestamp()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'CANCELLED' AND NEW.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'Cancellation timestamp is required'
        USING ERRCODE='23514', CONSTRAINT='orders_cancelled_at_required';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'CANCELLED' AND NEW.status = 'CANCELLED' THEN
    IF NEW.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'Cancellation timestamp is required'
        USING ERRCODE='23514', CONSTRAINT='orders_cancelled_at_required';
    END IF;
  ELSIF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    -- Includes legacy NULL: unrelated updates cannot invent a terminal date.
    RAISE EXCEPTION 'Cancellation timestamp is immutable'
      USING ERRCODE='23514', CONSTRAINT='orders_cancelled_at_immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_cancellation_timestamp()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_orders_cancelled_at_guard BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_cancellation_timestamp();
REVOKE ALL (cancelled_at) ON TABLE public.orders FROM PUBLIC, anon, authenticated;

COMMIT;
