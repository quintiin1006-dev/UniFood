BEGIN;

-- Dynamic daily menu (docs/propuesta-menu-dinamico.md, sections 2.1-2.5). Database only: no
-- endpoint, screen or order logic uses these tables yet, and MENU_DINAMICO_ENABLED is off.
--
-- One fixed-price plate per cafeteria. Its ingredients change every day: every daily row
-- carries business_date, supplied by Spring in America/Bogota (same rule as 013), so the menu
-- resets at midnight without a job. Orders keep a copy of what was chosen.
--
-- Re-runnable like 027: tables and indexes use IF NOT EXISTS, functions are replaced and
-- triggers are recreated. Closed to the browser like 013: RLS on, no policies, no grants.
-- 030 is the reminder limit migration; this one is 031.

-- 1. Plate per cafeteria: title and current fixed price. A change applies from the next
--    publication; each published day keeps its own copy in daily_menu_days.
CREATE TABLE IF NOT EXISTS public.daily_menu_settings (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  title varchar(100) NOT NULL DEFAULT 'Almuerzo del día',
  plate_price numeric(12,2),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_daily_menu_settings_title
    CHECK (title = btrim(title) AND length(title) BETWEEN 1 AND 100),
  CONSTRAINT chk_daily_menu_settings_price
    CHECK (plate_price IS NULL OR plate_price > 0)
);

-- 2. Category template per cafeteria. SINGLE: one choice per order. ADDITIONS: several.
--    position is unique and deferrable so a reorder fits in one transaction.
CREATE TABLE IF NOT EXISTS public.daily_menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  label varchar(60) NOT NULL,
  kind text NOT NULL,
  position integer NOT NULL,
  can_skip boolean NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_menu_categories_id_cafeteria UNIQUE (id, cafeteria_id),
  CONSTRAINT uq_daily_menu_categories_position
    UNIQUE (cafeteria_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT chk_daily_menu_categories_kind CHECK (kind IN ('SINGLE', 'ADDITIONS')),
  CONSTRAINT chk_daily_menu_categories_label
    CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 60),
  CONSTRAINT chk_daily_menu_categories_position CHECK (position >= 0),
  CONSTRAINT chk_daily_menu_categories_additions_optional
    CHECK (kind = 'SINGLE' OR can_skip)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_menu_categories_one_additions
  ON public.daily_menu_categories(cafeteria_id) WHERE kind = 'ADDITIONS';
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_menu_categories_label
  ON public.daily_menu_categories(cafeteria_id, lower(label));

-- 3. Additions catalog with the extra price set by the admin.
CREATE TABLE IF NOT EXISTS public.daily_menu_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  extra_price numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_menu_additions_id_cafeteria UNIQUE (id, cafeteria_id),
  CONSTRAINT chk_daily_menu_additions_name
    CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100),
  CONSTRAINT chk_daily_menu_additions_price CHECK (extra_price > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_menu_additions_name
  ON public.daily_menu_additions(cafeteria_id, lower(name));

-- 4. Day header. Created by the worker's first write. Publishing freezes title and price.
--    Spring increments version with WHERE version = expected, under FOR UPDATE.
CREATE TABLE IF NOT EXISTS public.daily_menu_days (
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  title_snapshot varchar(100),
  plate_price_snapshot numeric(12,2),
  published_at timestamptz,
  published_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cafeteria_id, business_date),
  CONSTRAINT chk_daily_menu_days_publication CHECK (
    (published_at IS NULL) = (published_by IS NULL)
    AND (published_at IS NULL
         OR (title_snapshot IS NOT NULL AND plate_price_snapshot > 0))
  )
);

-- 5. Today's ingredients, one per row, for SINGLE categories. Spring replaces a category's
--    options in one transaction with the day header locked. label_key is the duplicate rule.
CREATE TABLE IF NOT EXISTS public.daily_menu_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  category_id uuid NOT NULL,
  label varchar(350) NOT NULL,
  label_key text GENERATED ALWAYS AS (lower(btrim(label))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_daily_menu_options_day FOREIGN KEY (cafeteria_id, business_date)
    REFERENCES public.daily_menu_days(cafeteria_id, business_date) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_menu_options_category FOREIGN KEY (category_id, cafeteria_id)
    REFERENCES public.daily_menu_categories(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT uq_daily_menu_options_label
    UNIQUE (cafeteria_id, business_date, category_id, label_key),
  CONSTRAINT chk_daily_menu_options_label CHECK (
    label = btrim(label)
    AND length(label) BETWEEN 1 AND 350
    AND position(',' IN label) = 0
  )
);

-- Options only in SINGLE categories, and at most 350 characters per category and day
-- (DAILY_MENU_CATEGORY_TEXT_LIMIT). Changing 350 needs a new migration besides the constant.
-- The sum is exact only while writers hold the day header FOR UPDATE, as Spring does.
CREATE OR REPLACE FUNCTION public.guard_daily_menu_option()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  category_kind text;
  used integer;
BEGIN
  SELECT c.kind INTO category_kind
    FROM public.daily_menu_categories c WHERE c.id = NEW.category_id;
  IF category_kind IS DISTINCT FROM 'SINGLE' THEN
    RAISE EXCEPTION 'Daily menu options belong to SINGLE categories only'
      USING ERRCODE = '23514', CONSTRAINT = 'daily_menu_option_category_kind';
  END IF;
  SELECT coalesce(sum(length(o.label)), 0)::integer INTO used
    FROM public.daily_menu_options o
    WHERE o.cafeteria_id = NEW.cafeteria_id
      AND o.business_date = NEW.business_date
      AND o.category_id = NEW.category_id
      AND o.id IS DISTINCT FROM NEW.id;
  IF used + length(NEW.label) > 350 THEN
    RAISE EXCEPTION 'Daily menu category text exceeds 350 characters'
      USING ERRCODE = '23514', CONSTRAINT = 'daily_menu_option_text_budget';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_daily_menu_option() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_daily_menu_option_guard ON public.daily_menu_options;
CREATE TRIGGER trg_daily_menu_option_guard BEFORE INSERT OR UPDATE ON public.daily_menu_options
  FOR EACH ROW EXECUTE FUNCTION public.guard_daily_menu_option();

-- 6. Additions switched on today. extra_price is that day's price, copied when switched on.
CREATE TABLE IF NOT EXISTS public.daily_menu_addition_availability (
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  addition_id uuid NOT NULL,
  is_available boolean NOT NULL,
  extra_price numeric(12,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (addition_id, business_date),
  CONSTRAINT chk_daily_menu_addition_price CHECK (extra_price > 0),
  CONSTRAINT fk_daily_menu_addition_day FOREIGN KEY (cafeteria_id, business_date)
    REFERENCES public.daily_menu_days(cafeteria_id, business_date) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_menu_addition_item FOREIGN KEY (addition_id, cafeteria_id)
    REFERENCES public.daily_menu_additions(id, cafeteria_id) ON DELETE RESTRICT
);
-- Same lookup as idx_daily_items_cafeteria_date (013): a cafeteria's additions of one day.
CREATE INDEX IF NOT EXISTS idx_daily_menu_addition_cafeteria_date
  ON public.daily_menu_addition_availability(cafeteria_id, business_date);

-- 7. Order snapshot: header, one per order with a menu.
CREATE TABLE IF NOT EXISTS public.order_daily_menus (
  order_id uuid PRIMARY KEY,
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  title_snapshot varchar(100) NOT NULL,
  plate_price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_daily_menus_order_cafeteria UNIQUE (order_id, cafeteria_id),
  CONSTRAINT fk_order_daily_menu_order FOREIGN KEY (order_id, cafeteria_id)
    REFERENCES public.orders(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_daily_menu_price CHECK (plate_price > 0)
);

-- 8. Order snapshot: one row per choice (option, «Ninguna» or addition).
--    category_id, source_option_id and source_addition_id have no FK on purpose: they are
--    traceability and must not block deleting today's ingredients.
CREATE TABLE IF NOT EXISTS public.order_daily_menu_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  cafeteria_id uuid NOT NULL,
  line_kind text NOT NULL,
  category_id uuid NOT NULL,
  category_label varchar(60) NOT NULL,
  option_label varchar(350),
  extra_price numeric(12,2),
  source_option_id uuid,
  source_addition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_choice_order_menu FOREIGN KEY (order_id, cafeteria_id)
    REFERENCES public.order_daily_menus(order_id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT chk_choice_shape CHECK (
    (line_kind = 'OPTION' AND option_label IS NOT NULL AND extra_price IS NULL
       AND source_option_id IS NOT NULL AND source_addition_id IS NULL)
    OR (line_kind = 'NONE' AND option_label IS NULL AND extra_price IS NULL
       AND source_option_id IS NULL AND source_addition_id IS NULL)
    OR (line_kind = 'ADDITION' AND option_label IS NOT NULL AND extra_price > 0
       AND source_addition_id IS NOT NULL AND source_option_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_choice_one_per_category
  ON public.order_daily_menu_choices(order_id, category_id)
  WHERE line_kind IN ('OPTION', 'NONE');
CREATE UNIQUE INDEX IF NOT EXISTS uq_choice_addition_once
  ON public.order_daily_menu_choices(order_id, source_addition_id)
  WHERE line_kind = 'ADDITION';
-- Reading an order's choices covers every line kind; the partial indexes above do not.
CREATE INDEX IF NOT EXISTS idx_order_daily_menu_choices_order
  ON public.order_daily_menu_choices(order_id);

-- 9. Copied data never changes (same criterion as the 021 snapshots).
CREATE OR REPLACE FUNCTION public.forbid_daily_menu_snapshot_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Daily menu order snapshots are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'order_daily_menu_immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.forbid_daily_menu_snapshot_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_order_daily_menus_immutable ON public.order_daily_menus;
CREATE TRIGGER trg_order_daily_menus_immutable
  BEFORE UPDATE OR DELETE ON public.order_daily_menus
  FOR EACH ROW EXECUTE FUNCTION public.forbid_daily_menu_snapshot_change();
DROP TRIGGER IF EXISTS trg_order_daily_menu_choices_immutable ON public.order_daily_menu_choices;
CREATE TRIGGER trg_order_daily_menu_choices_immutable
  BEFORE UPDATE OR DELETE ON public.order_daily_menu_choices
  FOR EACH ROW EXECUTE FUNCTION public.forbid_daily_menu_snapshot_change();

-- 10. updated_at kept by the 001 function (already closed to the browser by 010).
DROP TRIGGER IF EXISTS trg_daily_menu_settings_updated_at ON public.daily_menu_settings;
CREATE TRIGGER trg_daily_menu_settings_updated_at BEFORE UPDATE ON public.daily_menu_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_daily_menu_categories_updated_at ON public.daily_menu_categories;
CREATE TRIGGER trg_daily_menu_categories_updated_at BEFORE UPDATE ON public.daily_menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_daily_menu_additions_updated_at ON public.daily_menu_additions;
CREATE TRIGGER trg_daily_menu_additions_updated_at BEFORE UPDATE ON public.daily_menu_additions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_daily_menu_days_updated_at ON public.daily_menu_days;
CREATE TRIGGER trg_daily_menu_days_updated_at BEFORE UPDATE ON public.daily_menu_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_daily_menu_addition_availability_updated_at
  ON public.daily_menu_addition_availability;
CREATE TRIGGER trg_daily_menu_addition_availability_updated_at
  BEFORE UPDATE ON public.daily_menu_addition_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 11. Closed: RLS without policies and no privilege for the browser (013 pattern).
ALTER TABLE public.daily_menu_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_additions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_addition_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_daily_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_daily_menu_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.daily_menu_settings, public.daily_menu_categories, public.daily_menu_additions,
  public.daily_menu_days, public.daily_menu_options, public.daily_menu_addition_availability,
  public.order_daily_menus, public.order_daily_menu_choices
  FROM PUBLIC, anon, authenticated;
-- No sequences (ids are gen_random_uuid()), policies, views or scheduled jobs are created.

COMMIT;

-- Reverse (reverse order; only on a temporary database, it drops every menu and snapshot):
-- BEGIN;
-- DROP TABLE IF EXISTS public.order_daily_menu_choices, public.order_daily_menus,
--   public.daily_menu_addition_availability, public.daily_menu_options,
--   public.daily_menu_days, public.daily_menu_additions, public.daily_menu_categories,
--   public.daily_menu_settings;
-- DROP FUNCTION IF EXISTS public.forbid_daily_menu_snapshot_change();
-- DROP FUNCTION IF EXISTS public.guard_daily_menu_option();
-- COMMIT;
