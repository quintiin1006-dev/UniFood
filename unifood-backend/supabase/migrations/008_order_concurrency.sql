BEGIN;
ALTER TABLE public.orders
  ADD COLUMN version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  ADD COLUMN cancelled_by_client boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT orders_client_cancellation_state CHECK (NOT cancelled_by_client OR status = 'CANCELLED');
-- Hibernate uses version=old+1 with WHERE version=old. Increment on privileged
-- SQL updates too so a future internal writer cannot bypass stale-write detection.
CREATE FUNCTION public.advance_order_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_order_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_order_version BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.advance_order_version();
COMMIT;
