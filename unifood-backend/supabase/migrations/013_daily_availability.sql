BEGIN;

-- Classification must be completed explicitly after 012. Never repair it here.
LOCK TABLE public.lunches IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE pending uuid;
BEGIN
  SELECT id INTO pending FROM public.lunches WHERE category IS NULL LIMIT 1;
  IF pending IS NOT NULL THEN
    RAISE EXCEPTION 'Unclassified catalog item %. Complete explicit classification before migration.', pending
      USING ERRCODE='23514', CONSTRAINT='daily_availability_category_audit';
  END IF;
END;
$$;
ALTER TABLE public.lunches ALTER COLUMN category SET NOT NULL;

CREATE TABLE public.cafeteria_daily_states (
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  is_open boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cafeteria_id,business_date)
);

CREATE TABLE public.daily_item_availability (
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  business_date date NOT NULL,
  is_available boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id,business_date),
  CONSTRAINT fk_daily_item_cafeteria FOREIGN KEY (item_id,cafeteria_id)
    REFERENCES public.lunches(id,cafeteria_id) ON DELETE RESTRICT
);
CREATE INDEX idx_daily_items_cafeteria_date
  ON public.daily_item_availability(cafeteria_id,business_date);

-- No current-date checks: historical records remain valid. Business date is
-- supplied by Spring in America/Bogota, never derived from the DB session zone.
ALTER TABLE public.cafeteria_daily_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_item_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cafeteria_daily_states, public.daily_item_availability
  FROM PUBLIC, anon, authenticated;
REVOKE ALL (cafeteria_id,business_date,is_open,created_at,updated_at)
  ON TABLE public.cafeteria_daily_states FROM PUBLIC, anon, authenticated;
REVOKE ALL (cafeteria_id,item_id,business_date,is_available,created_at,updated_at)
  ON TABLE public.daily_item_availability FROM PUBLIC, anon, authenticated;
-- No sequences, helpers, policies, daily backfill or scheduled jobs are created.
COMMIT;
