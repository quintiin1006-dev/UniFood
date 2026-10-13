BEGIN;

-- Classification is explicit. NULL means pending administrative classification;
-- it is not a functional category and does not define daily availability.
CREATE TYPE public.catalog_category AS ENUM (
  'DEL_DIA',
  'CORRIENTE',
  'EJECUTIVO',
  'ESPECIAL',
  'DESAYUNO'
);

-- New types otherwise grant PUBLIC USAGE by default. Close inherited browser
-- privileges in the same transaction; the migration owner retains its access.
REVOKE USAGE ON TYPE public.catalog_category
FROM PUBLIC, anon, authenticated;

ALTER TABLE public.lunches ADD COLUMN category public.catalog_category;

-- No default, backfill, NOT NULL or grants: legacy products stay unclassified
-- and post-010 business table/column permissions remain closed.
COMMIT;
