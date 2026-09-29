BEGIN;

-- ============================================================
-- UniFood - Multi-institution support
-- Migration: 002_multi_institution.sql
--
-- Architecture:
--
--                    Institution
--                         │
--                        Sites
--                         │
--                     Cafeterias
--                    /     |      \
--               Admin   Worker   Lunches
--                                  │
--                                Orders
--
-- CLIENT:
--   User -> Client -> Institution
--
-- ADMIN / WORKER:
--   User -> Cafeteria_users -> Cafeteria
--
-- SUPER_ADMIN:
--   Platform-wide
-- ============================================================


-- ============================================================
-- 1. INSTITUTIONS
-- ============================================================

CREATE TABLE public.institutions (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                                     name VARCHAR(200) NOT NULL,

    -- Institutional email domain.
    -- Example: ustavillavo.edu.co
                                     email_domain VARCHAR(255) NOT NULL UNIQUE,

    -- Brand shown to users.
    -- Example: SantotoFood
                                     brand_name VARCHAR(100) NOT NULL,

                                     logo_url TEXT,

                                     primary_color VARCHAR(20),
                                     secondary_color VARCHAR(20),

                                     is_active BOOLEAN NOT NULL DEFAULT TRUE,

                                     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                                     CONSTRAINT chk_institution_name
                                         CHECK (length(trim(name)) > 0),

                                     CONSTRAINT chk_institution_email_domain
                                         CHECK (length(trim(email_domain)) > 0),

                                     CONSTRAINT chk_institution_brand_name
                                         CHECK (length(trim(brand_name)) > 0)
);


-- ============================================================
-- 2. INITIAL INSTITUTION
-- ============================================================
--
-- First institution of the platform:
-- Universidad Santo Tomás - Villavicencio
--
-- This allows the current project to operate as SantotoFood
-- while the platform grows into UniFood.
-- ============================================================

INSERT INTO public.institutions (
    name,
    email_domain,
    brand_name
)
VALUES (
           'Universidad Santo Tomás',
           'ustavillavo.edu.co',
           'SantotoFood'
       )
    ON CONFLICT (email_domain) DO NOTHING;


-- ============================================================
-- 3. INSTITUTION -> SITES
-- ============================================================

ALTER TABLE public.sites
    ADD COLUMN institution_id UUID;


-- There are currently no clients, but existing sites must still
-- belong to an institution.
--
-- Since the current project only has Universidad Santo Tomás,
-- existing sites are assigned to that institution.

UPDATE public.sites
SET institution_id = (
    SELECT id
    FROM public.institutions
    WHERE email_domain = 'ustavillavo.edu.co'
)
WHERE institution_id IS NULL;


ALTER TABLE public.sites
    ALTER COLUMN institution_id SET NOT NULL;


ALTER TABLE public.sites
    ADD CONSTRAINT fk_sites_institution
        FOREIGN KEY (institution_id)
            REFERENCES public.institutions(id)
            ON DELETE RESTRICT;


CREATE INDEX idx_sites_institution_id
    ON public.sites(institution_id);


-- A site name must be unique within an institution.
ALTER TABLE public.sites
    ADD CONSTRAINT uq_site_name_per_institution
        UNIQUE (institution_id, name);


-- ============================================================
-- 4. CLIENT -> INSTITUTION
-- ============================================================

ALTER TABLE public.clients
    ADD COLUMN institution_id UUID NOT NULL
        REFERENCES public.institutions(id)
            ON DELETE RESTRICT;


CREATE INDEX idx_clients_institution_id
    ON public.clients(institution_id);


-- ============================================================
-- 5. UPDATED_AT TRIGGER FOR INSTITUTIONS
-- ============================================================

CREATE TRIGGER trg_institutions_updated_at
    BEFORE UPDATE ON public.institutions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 6. ROW LEVEL SECURITY - INSTITUTIONS
-- ============================================================

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 7. CLIENTS CAN SEE ACTIVE INSTITUTIONS
-- ============================================================

CREATE POLICY institutions_select_active
ON public.institutions
FOR SELECT
               TO authenticated
               USING (
               is_active = TRUE
               );


-- ============================================================
-- 8. SITES - ONLY CLIENT'S INSTITUTION
-- ============================================================

DROP POLICY IF EXISTS sites_select_active
ON public.sites;


CREATE POLICY sites_select_own_institution
ON public.sites
FOR SELECT
                    TO authenticated
                    USING (
                    is_active = TRUE
                    AND EXISTS (
                    SELECT 1
                    FROM public.clients cl
                    WHERE cl.user_id = auth.uid()
                    AND cl.institution_id = sites.institution_id
                    )
                    );


-- ============================================================
-- 9. CAFETERIAS - ONLY CLIENT'S INSTITUTION
-- ============================================================

DROP POLICY IF EXISTS cafeterias_select_active
ON public.cafeterias;


CREATE POLICY cafeterias_select_own_institution
ON public.cafeterias
FOR SELECT
                    TO authenticated
                    USING (
                    is_active = TRUE
                    AND EXISTS (
                    SELECT 1
                    FROM public.sites s
                    JOIN public.clients cl
                    ON cl.institution_id = s.institution_id
                    WHERE s.id = cafeterias.site_id
                    AND cl.user_id = auth.uid()
                    AND s.is_active = TRUE
                    )
                    );


-- ============================================================
-- 10. LUNCHES - ONLY CLIENT'S INSTITUTION
-- ============================================================

DROP POLICY IF EXISTS lunches_select_active
ON public.lunches;


CREATE POLICY lunches_select_own_institution
ON public.lunches
FOR SELECT
                    TO authenticated
                    USING (
                    is_active = TRUE
                    AND EXISTS (
                    SELECT 1
                    FROM public.cafeterias c
                    JOIN public.sites s
                    ON s.id = c.site_id
                    JOIN public.clients cl
                    ON cl.institution_id = s.institution_id
                    WHERE c.id = lunches.cafeteria_id
                    AND c.is_active = TRUE
                    AND s.is_active = TRUE
                    AND cl.user_id = auth.uid()
                    )
                    );


-- ============================================================
-- 11. DOCUMENTATION
-- ============================================================

COMMENT ON TABLE public.institutions IS
    'Educational institutions using the UniFood platform.';

COMMENT ON COLUMN public.institutions.email_domain IS
    'Institutional email domain used to identify the institution during client registration.';

COMMENT ON COLUMN public.institutions.brand_name IS
    'Brand displayed to users, for example SantotoFood or CopeFood.';

COMMENT ON COLUMN public.sites.institution_id IS
    'Institution that owns the site.';

COMMENT ON COLUMN public.clients.institution_id IS
    'Institution to which the client belongs.';


COMMIT;