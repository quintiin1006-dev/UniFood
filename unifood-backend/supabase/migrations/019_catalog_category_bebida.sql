-- Adds the BEBIDA catalog category (docs/decisiones.md §6).
--
-- Deliberately outside BEGIN/COMMIT: a value added to an enum cannot be used in the
-- transaction that adds it, so nothing else runs here. IF NOT EXISTS makes a second run
-- harmless. The type's privileges from 012 are unchanged: ADD VALUE grants nothing.
ALTER TYPE public.catalog_category ADD VALUE IF NOT EXISTS 'BEBIDA';

-- Reverse: PostgreSQL cannot drop an enum value. Before reverting, move every BEBIDA
-- product to another category and recreate the type without it:
--
-- BEGIN;
-- UPDATE public.lunches SET category = 'DEL_DIA' WHERE category = 'BEBIDA';
-- ALTER TYPE public.catalog_category RENAME TO catalog_category_old;
-- CREATE TYPE public.catalog_category AS ENUM ('DEL_DIA', 'CORRIENTE', 'EJECUTIVO', 'ESPECIAL', 'DESAYUNO');
-- REVOKE USAGE ON TYPE public.catalog_category FROM PUBLIC, anon, authenticated;
-- ALTER TABLE public.lunches
--   ALTER COLUMN category TYPE public.catalog_category USING category::text::public.catalog_category;
-- DROP TYPE public.catalog_category_old;
-- COMMIT;
