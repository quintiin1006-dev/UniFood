BEGIN;

-- SantotoFood - Initial schema
-- Hexagonal architecture: business rules remain in Spring Boot.
-- PostgreSQL handles persistence, integrity, RLS, timestamps and atomic stock.

CREATE TYPE public.app_role AS ENUM ('CLIENT','WORKER','ADMIN','SUPER_ADMIN');

CREATE TYPE public.order_status AS ENUM (
  'PENDING',
  'PREPARING',
  'READY',
  'CALLED',
  'DELIVERED',
  'CANCELLED'
);

CREATE TYPE public.payment_method AS ENUM ('CASH');

CREATE TYPE public.payment_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED'
);

CREATE TYPE public.notification_type AS ENUM (
  'ORDER_RECEIVED',
  'ORDER_PREPARING',
  'ORDER_READY',
  'ORDER_CALLED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED'
);

CREATE TYPE public.notification_channel AS ENUM (
  'IN_APP',
  'SMS',
  'WHATSAPP'
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
RETURN NEW;
END;
$$;

CREATE TABLE public.users (
                              id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
                              email VARCHAR(255) NOT NULL UNIQUE,
                              is_active BOOLEAN NOT NULL DEFAULT TRUE,
                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.roles (
                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              name public.app_role NOT NULL UNIQUE
);

CREATE TABLE public.user_roles (
                                   user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                                   role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
                                   PRIMARY KEY (user_id, role_id)
);

CREATE TABLE public.clients (
                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
                                full_name VARCHAR(150) NOT NULL,
                                document VARCHAR(30) NOT NULL UNIQUE,
                                phone VARCHAR(30) NOT NULL,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.sites (
                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              name VARCHAR(150) NOT NULL,
                              city VARCHAR(100) NOT NULL,
                              is_active BOOLEAN NOT NULL DEFAULT TRUE,
                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.cafeterias (
                                   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                   site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
                                   name VARCHAR(150) NOT NULL,
                                   is_active BOOLEAN NOT NULL DEFAULT TRUE,
                                   service_available BOOLEAN NOT NULL DEFAULT TRUE,
                                   lunch_order_start TIME NOT NULL,
                                   lunch_order_end TIME NOT NULL,
                                   cancellation_window_minutes INTEGER NOT NULL DEFAULT 10,
                                   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                                   CONSTRAINT chk_cafeteria_lunch_hours
                                       CHECK (lunch_order_start < lunch_order_end),

                                   CONSTRAINT chk_cafeteria_cancellation_window
                                       CHECK (cancellation_window_minutes >= 0),

                                   CONSTRAINT uq_cafeteria_name_per_site
                                       UNIQUE (site_id, name)
);

CREATE TABLE public.cafeteria_users (
                                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                        cafeteria_id UUID NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
                                        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
                                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                                        CONSTRAINT uq_cafeteria_user
                                            UNIQUE (cafeteria_id, user_id)
);

CREATE TABLE public.lunches (
                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                cafeteria_id UUID NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
                                name VARCHAR(150) NOT NULL,
                                description TEXT,
                                price NUMERIC(12,2) NOT NULL,
                                image_url TEXT,
                                stock INTEGER NOT NULL DEFAULT 0,
                                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                                CONSTRAINT chk_lunch_price
                                    CHECK (price > 0),

                                CONSTRAINT chk_lunch_stock
                                    CHECK (stock >= 0),

                                CONSTRAINT uq_lunch_name_per_cafeteria
                                    UNIQUE (cafeteria_id, name)
);

CREATE TABLE public.orders (
                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                               cafeteria_id UUID NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
                               client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
                               client_name VARCHAR(150) NOT NULL,
                               client_document VARCHAR(30),
                               status public.order_status NOT NULL DEFAULT 'PENDING',
                               total NUMERIC(12,2) NOT NULL,
                               cancellation_deadline TIMESTAMPTZ,
                               created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                               updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                               CONSTRAINT chk_order_total
                                   CHECK (total >= 0)
);

CREATE TABLE public.order_items (
                                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
                                    lunch_id UUID NOT NULL REFERENCES public.lunches(id) ON DELETE RESTRICT,
                                    lunch_name VARCHAR(150) NOT NULL,
                                    unit_price NUMERIC(12,2) NOT NULL,
                                    quantity INTEGER NOT NULL,
                                    beverage_choice VARCHAR(100),
                                    note TEXT,
                                    subtotal NUMERIC(12,2) NOT NULL,

                                    CONSTRAINT chk_order_item_price
                                        CHECK (unit_price > 0),

                                    CONSTRAINT chk_order_item_quantity
                                        CHECK (quantity > 0),

                                    CONSTRAINT chk_order_item_subtotal
                                        CHECK (subtotal >= 0)
);

CREATE TABLE public.payments (
                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                 order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
                                 method public.payment_method NOT NULL DEFAULT 'CASH',
                                 status public.payment_status NOT NULL DEFAULT 'PENDING',
                                 amount NUMERIC(12,2) NOT NULL,
                                 transaction_reference VARCHAR(255),
                                 paid_at TIMESTAMPTZ,
                                 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                                 CONSTRAINT chk_payment_amount
                                     CHECK (amount >= 0)
);

CREATE TABLE public.notifications (
                                      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                                      order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
                                      type public.notification_type NOT NULL,
                                      title VARCHAR(150) NOT NULL,
                                      message TEXT NOT NULL,
                                      channel public.notification_channel NOT NULL,
                                      is_read BOOLEAN NOT NULL DEFAULT FALSE,
                                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.notification_preferences (
                                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                 user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
                                                 in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                                                 sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                                                 whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                                                 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                                 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_cafeterias_updated_at
    BEFORE UPDATE ON public.cafeterias
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_lunches_updated_at
    BEFORE UPDATE ON public.lunches
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_cafeterias_site_id
    ON public.cafeterias(site_id);

CREATE INDEX idx_cafeteria_users_cafeteria_id
    ON public.cafeteria_users(cafeteria_id);

CREATE INDEX idx_cafeteria_users_user_id
    ON public.cafeteria_users(user_id);

CREATE INDEX idx_lunches_cafeteria_active
    ON public.lunches(cafeteria_id, is_active);

CREATE INDEX idx_orders_cafeteria_status_created
    ON public.orders(cafeteria_id, status, created_at DESC);

CREATE INDEX idx_orders_client_id
    ON public.orders(client_id);

CREATE INDEX idx_order_items_order_id
    ON public.order_items(order_id);

CREATE INDEX idx_order_items_lunch_id
    ON public.order_items(lunch_id);

CREATE INDEX idx_notifications_user_read_created
    ON public.notifications(user_id, is_read, created_at DESC);

CREATE INDEX idx_notifications_order_id
    ON public.notifications(order_id);

-- Atomic stock primitive.
-- Spring Boot owns the transaction and use case.

CREATE OR REPLACE FUNCTION public.decrease_lunch_stock(
  p_lunch_id UUID,
  p_quantity INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
rows_updated INTEGER;
BEGIN

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
END IF;

UPDATE public.lunches
SET stock = stock - p_quantity
WHERE id = p_lunch_id
  AND is_active = TRUE
  AND stock >= p_quantity;

GET DIAGNOSTICS rows_updated = ROW_COUNT;

RETURN rows_updated = 1;
END;
$$;

INSERT INTO public.roles (name)
VALUES
    ('CLIENT'),
    ('WORKER'),
    ('ADMIN'),
    ('SUPER_ADMIN');

-- RLS: direct frontend access is restricted.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafeterias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafeteria_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lunches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own
ON public.users
FOR SELECT
               TO authenticated
               USING (id = auth.uid());

CREATE POLICY clients_select_own
ON public.clients
FOR SELECT
               TO authenticated
               USING (user_id = auth.uid());

CREATE POLICY clients_update_own
ON public.clients
FOR UPDATE
               TO authenticated
               USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY sites_select_active
ON public.sites
FOR SELECT
               TO authenticated
               USING (is_active = TRUE);

CREATE POLICY cafeterias_select_active
ON public.cafeterias
FOR SELECT
               TO authenticated
               USING (is_active = TRUE);

CREATE POLICY lunches_select_active
ON public.lunches
FOR SELECT
               TO authenticated
               USING (
               is_active = TRUE
               AND EXISTS (
               SELECT 1
               FROM public.cafeterias c
               WHERE c.id = lunches.cafeteria_id
               AND c.is_active = TRUE
               )
               );

CREATE POLICY orders_select_own
ON public.orders
FOR SELECT
               TO authenticated
               USING (
               client_id IN (
               SELECT c.id
               FROM public.clients c
               WHERE c.user_id = auth.uid()
               )
               );

CREATE POLICY order_items_select_own
ON public.order_items
FOR SELECT
               TO authenticated
               USING (
               EXISTS (
               SELECT 1
               FROM public.orders o
               JOIN public.clients c
               ON c.id = o.client_id
               WHERE o.id = order_items.order_id
               AND c.user_id = auth.uid()
               )
               );

CREATE POLICY payments_select_own
ON public.payments
FOR SELECT
               TO authenticated
               USING (
               EXISTS (
               SELECT 1
               FROM public.orders o
               JOIN public.clients c
               ON c.id = o.client_id
               WHERE o.id = payments.order_id
               AND c.user_id = auth.uid()
               )
               );

CREATE POLICY notifications_select_own
ON public.notifications
FOR SELECT
               TO authenticated
               USING (user_id = auth.uid());

CREATE POLICY notifications_update_own
ON public.notifications
FOR UPDATE
               TO authenticated
               USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY notification_preferences_select_own
ON public.notification_preferences
FOR SELECT
               TO authenticated
               USING (user_id = auth.uid());

CREATE POLICY notification_preferences_update_own
ON public.notification_preferences
FOR UPDATE
               TO authenticated
               USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

COMMIT;