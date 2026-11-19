BEGIN;

-- Raises the reminder limit of a CALLED order from 3 to 5 (docs/decisiones.md, jj/cliente-ajustes).
-- The backend rule lives in Order.MAX_REMINDERS; this CHECK is its database guard.
--
-- 004_calls_module.sql stays in the history and is never edited: it is applied and its checksum
-- is recorded. Existing rows have reminder_count <= 3, so the wider CHECK validates at once.
-- Re-runnable: the old constraint is dropped only if it exists, and the new one replaces it.

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS chk_order_reminder_count;

ALTER TABLE public.orders
    ADD CONSTRAINT chk_order_reminder_count
        CHECK (
            reminder_count >= 0
                AND reminder_count <= 5
            );

-- Business tables stay closed to the browser (no grant is added by this migration).
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;

COMMIT;
