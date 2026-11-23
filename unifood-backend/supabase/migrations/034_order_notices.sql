BEGIN;

-- Recent notices of the client's own orders (the bell's inbox). One row per order event the
-- client was told about, written by the backend in the same transaction as the order transition,
-- whether or not a push was sent: push can be off, fail, or be rate limited, and the inbox must
-- still show the event.
--
-- user_id and cafeteria_id are copied from the order and its client by the backend, never from the
-- browser. Texts are not stored: the web resolves them from kind.
--
-- sequence tells repeated events of the same kind apart: the reminder number (1, 2, ...) for
-- REMINDER, 0 for every other kind. (order_id, kind, sequence) is the event key; the backend
-- inserts with ON CONFLICT DO NOTHING, so a retried request never duplicates a notice.
--
-- read_at is set when the client opens the inbox. The table is closed to the browser: RLS on and
-- no grants for the API roles.

CREATE TABLE IF NOT EXISTS public.order_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT uq_order_notices_event UNIQUE (order_id, kind, sequence),
  CONSTRAINT chk_order_notices_kind CHECK (
    kind IN (
      'PREPARING',
      'READY',
      'CALLED',
      'REMINDER',
      'DELIVERED',
      'NOT_COLLECTED',
      'REJECTED',
      'CANCELLED_BY_CLIENT'
    )
  ),
  CONSTRAINT chk_order_notices_sequence CHECK (
    (kind = 'REMINDER' AND sequence >= 1) OR (kind <> 'REMINDER' AND sequence = 0)
  )
);

-- The inbox reads the last notices of one user; the cafeteria index leaves room for an admin view.
CREATE INDEX IF NOT EXISTS idx_order_notices_user_recent
  ON public.order_notices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_notices_cafeteria_recent
  ON public.order_notices (cafeteria_id, created_at DESC);

COMMENT ON TABLE public.order_notices IS
  'Order notices of each client (the bell inbox). Server-only; written and read by the backend.';
COMMENT ON COLUMN public.order_notices.sequence IS
  'Reminder number for REMINDER, 0 for every other kind. Part of the event key.';

ALTER TABLE public.order_notices ENABLE ROW LEVEL SECURITY;

-- Closed to every API role, as 027. The backend reaches the table through its own connection.
DO $block$
DECLARE
  grantee text;
BEGIN
  EXECUTE 'REVOKE ALL ON public.order_notices FROM PUBLIC';
  FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = grantee) THEN
      EXECUTE format('REVOKE ALL ON public.order_notices FROM %I', grantee);
    END IF;
  END LOOP;
END;
$block$;

COMMIT;

-- Reverse (run by hand only if this migration must be undone; it drops every stored notice):
--
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_order_notices_cafeteria_recent;
-- DROP INDEX IF EXISTS public.idx_order_notices_user_recent;
-- DROP TABLE IF EXISTS public.order_notices;
-- COMMIT;
