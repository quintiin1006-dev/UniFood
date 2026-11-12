BEGIN;

-- Optional pickup time chosen by the client for one order (docs/decisiones.md §6). It is
-- informative only: the worker's FIFO queue stays ordered by created_at, and the daily
-- close (B19) neither reads nor writes it. NULL means "as soon as possible".
--
-- Spring validates it when the order is created (later than now and within the current
-- business day in America/Bogota), because "now" is Spring's TimeProvider, not now() of
-- the database. No CHECK here compares it with created_at for the same reason.
--
-- 022 is reserved for the subscription switch.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS requested_pickup_at timestamptz;

COMMENT ON COLUMN public.orders.requested_pickup_at IS
  'Optional pickup time requested by the client; informative, never changes the FIFO order.';

-- The new column inherits the table's closed grants from 010; nothing is opened here.
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse:
--
-- BEGIN;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS requested_pickup_at;
-- COMMIT;
