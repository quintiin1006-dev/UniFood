BEGIN;

-- ============================================================
-- UniFood - Módulo de Llamadas
-- ============================================================


-- ============================================================
-- 1. NUEVO ESTADO DEL PEDIDO
-- ============================================================

ALTER TYPE public.order_status
    ADD VALUE IF NOT EXISTS 'NOT_COLLECTED';


-- ============================================================
-- 2. INFORMACIÓN DEL PROCESO DE LLAMADAS
-- ============================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS not_collected_at TIMESTAMPTZ;


-- ============================================================
-- 3. REGLA: MÁXIMO 3 RECORDATORIOS
-- ============================================================

ALTER TABLE public.orders
    ADD CONSTRAINT chk_order_reminder_count
        CHECK (
            reminder_count >= 0
                AND reminder_count <= 3
            );


-- ============================================================
-- 4. ÍNDICE PARA EL MÓDULO DE LLAMADAS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_cafeteria_status_called
    ON public.orders (
    cafeteria_id,
    status,
    called_at DESC
    );


-- ============================================================
-- 5. ÍNDICE PARA HISTORIAL DE NO RECOGIDOS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_cafeteria_not_collected
    ON public.orders (
    cafeteria_id,
    status,
    not_collected_at DESC
    );


COMMIT;