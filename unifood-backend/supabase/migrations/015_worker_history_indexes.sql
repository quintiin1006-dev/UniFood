BEGIN;
-- Approved after EXPLAIN ANALYZE. No data, privileges or existing indexes change.
CREATE INDEX idx_orders_delivered_history
  ON public.orders(cafeteria_id, delivered_at DESC, id DESC)
  WHERE status = 'DELIVERED' AND delivered_at IS NOT NULL;
CREATE INDEX idx_orders_cancelled_history
  ON public.orders(cafeteria_id, cancelled_at DESC, id DESC)
  WHERE status = 'CANCELLED' AND cancelled_at IS NOT NULL;
COMMIT;
