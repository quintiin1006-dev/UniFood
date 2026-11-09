BEGIN;

-- Order creation support (docs/decisiones.md §6 and §11): idempotent creation, one active
-- order per client, and the client's history. Schema only; Spring uses it in B15.

-- No order changes between the audit and the unique indexes.
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;

-- "Active" means not terminal: the client still has something to pick up or cancel.
--   PENDING, PREPARING, READY, CALLED  -> active
--   DELIVERED, NOT_COLLECTED, CANCELLED -> terminal (each one closes the order for good)
-- Orders without a client (anonymised by ON DELETE SET NULL) are never compared.
DO $$
DECLARE
  duplicated text;
BEGIN
  SELECT string_agg(client_id::text, ', ') INTO duplicated FROM (
    SELECT client_id FROM public.orders
    WHERE client_id IS NOT NULL AND status IN ('PENDING', 'PREPARING', 'READY', 'CALLED')
    GROUP BY client_id HAVING count(*) > 1
    LIMIT 20
  ) d;
  IF duplicated IS NOT NULL THEN
    RAISE EXCEPTION '020 needs at most one active order per client; finish or cancel the extra ones first. Clients: %', duplicated
      USING ERRCODE = '23505', CONSTRAINT = 'uq_orders_one_active_per_client';
  END IF;
END;
$$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128),
  ADD COLUMN IF NOT EXISTS request_hash char(64);

-- Both or neither: a key without the body's hash could not tell a retry from a reuse.
-- The key is opaque to the server; the hash is a lowercase SHA-256 hex digest.
-- DROP ... IF EXISTS first keeps a second run harmless.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_idempotency_pair,
  DROP CONSTRAINT IF EXISTS chk_orders_idempotency_key_format,
  DROP CONSTRAINT IF EXISTS chk_orders_request_hash_format,
  ADD CONSTRAINT chk_orders_idempotency_pair
    CHECK ((idempotency_key IS NULL) = (request_hash IS NULL)),
  ADD CONSTRAINT chk_orders_idempotency_key_format
    CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT chk_orders_request_hash_format
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

-- A key is used once per client, for good: replaying it after delivery is still a retry.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_idempotency_key
  ON public.orders(client_id, idempotency_key)
  WHERE client_id IS NOT NULL AND idempotency_key IS NOT NULL;

-- The database, not the service, guarantees a single active order: two concurrent
-- creations for the same client end with exactly one unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_one_active_per_client
  ON public.orders(client_id)
  WHERE client_id IS NOT NULL AND status IN ('PENDING', 'PREPARING', 'READY', 'CALLED');

-- Client history, newest first, with a stable tiebreak for cursor pagination.
CREATE INDEX IF NOT EXISTS idx_orders_client_history
  ON public.orders(client_id, created_at DESC, id DESC)
  WHERE client_id IS NOT NULL;

-- New columns inherit the table's closed grants from 010; nothing is opened here.
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse:
--
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_orders_client_history;
-- DROP INDEX IF EXISTS public.uq_orders_one_active_per_client;
-- DROP INDEX IF EXISTS public.uq_orders_client_idempotency_key;
-- ALTER TABLE public.orders
--   DROP CONSTRAINT IF EXISTS chk_orders_request_hash_format,
--   DROP CONSTRAINT IF EXISTS chk_orders_idempotency_key_format,
--   DROP CONSTRAINT IF EXISTS chk_orders_idempotency_pair,
--   DROP COLUMN IF EXISTS request_hash,
--   DROP COLUMN IF EXISTS idempotency_key;
-- COMMIT;
