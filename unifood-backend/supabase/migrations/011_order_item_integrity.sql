BEGIN;
LOCK TABLE public.order_items, public.orders, public.lunches IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE incompatible uuid;
BEGIN
  SELECT i.id INTO incompatible FROM public.order_items i
    LEFT JOIN public.orders o ON o.id=i.order_id LEFT JOIN public.lunches l ON l.id=i.lunch_id
    WHERE o.id IS NULL OR l.id IS NULL OR o.cafeteria_id<>l.cafeteria_id
      OR i.subtotal<>i.unit_price*i.quantity LIMIT 1;
  IF incompatible IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible order item %. Audit explicitly before migration; historical amounts are never repaired automatically.', incompatible
      USING ERRCODE='23514', CONSTRAINT='order_item_integrity_audit';
  END IF;
END;
$$;
ALTER TABLE public.orders ADD CONSTRAINT uq_orders_id_cafeteria UNIQUE(id,cafeteria_id);
ALTER TABLE public.lunches ADD CONSTRAINT uq_lunches_id_cafeteria UNIQUE(id,cafeteria_id);
ALTER TABLE public.order_items ADD COLUMN cafeteria_id uuid;
-- Structural key backfill only, after validating every existing relation/snapshot.
UPDATE public.order_items i SET cafeteria_id=o.cafeteria_id FROM public.orders o WHERE o.id=i.order_id;
ALTER TABLE public.order_items
  ALTER COLUMN cafeteria_id SET NOT NULL,
  ADD CONSTRAINT fk_item_order_cafeteria FOREIGN KEY(order_id,cafeteria_id) REFERENCES public.orders(id,cafeteria_id),
  ADD CONSTRAINT fk_item_lunch_cafeteria FOREIGN KEY(lunch_id,cafeteria_id) REFERENCES public.lunches(id,cafeteria_id),
  ADD CONSTRAINT chk_item_subtotal CHECK(subtotal=unit_price*quantity);
CREATE INDEX idx_items_lunch_cafeteria ON public.order_items(lunch_id,cafeteria_id);
-- Existing internal writers need not duplicate a relationship key. A supplied
-- wrong key is never corrected; the composite foreign keys reject it.
CREATE FUNCTION public.derive_order_item_cafeteria()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.cafeteria_id IS NULL THEN
    SELECT o.cafeteria_id INTO NEW.cafeteria_id FROM public.orders o WHERE o.id=NEW.order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order reference does not exist' USING ERRCODE='23503', CONSTRAINT='fk_item_order_cafeteria';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.derive_order_item_cafeteria() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_item_cafeteria BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_order_item_cafeteria();
COMMIT;
