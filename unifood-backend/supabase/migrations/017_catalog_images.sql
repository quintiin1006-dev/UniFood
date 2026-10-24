BEGIN;

-- Legacy image_url values are deliberately left untouched.
CREATE TABLE public.catalog_image_assets (
  id uuid PRIMARY KEY,
  cafeteria_id uuid NOT NULL,
  product_id uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 3145728),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('UPLOADING','CURRENT','RETIRED','DELETING','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleanup_after timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  CONSTRAINT fk_image_product FOREIGN KEY (product_id, cafeteria_id)
    REFERENCES public.lunches(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT uq_image_ownership UNIQUE (id, product_id, cafeteria_id),
  CONSTRAINT ck_image_key CHECK (object_key = 'cafeterias/' || cafeteria_id::text || '/products/' || product_id::text || '/' || id::text || CASE content_type WHEN 'image/jpeg' THEN '.jpg' ELSE '.png' END)
);

ALTER TABLE public.lunches ADD COLUMN image_asset_id uuid;
ALTER TABLE public.lunches ADD CONSTRAINT fk_lunch_current_image
  FOREIGN KEY (image_asset_id, id, cafeteria_id)
  REFERENCES public.catalog_image_assets(id, product_id, cafeteria_id) ON DELETE RESTRICT;

CREATE TABLE public.catalog_image_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  cafeteria_id uuid NOT NULL,
  product_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('UPLOAD','REMOVE')),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  asset_id uuid,
  state text NOT NULL CHECK (state IN ('PROCESSING','APPLIED','REJECTED')),
  applied_version bigint,
  failure_status integer,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  CONSTRAINT uq_image_idempotency UNIQUE (actor_id, idempotency_key),
  CONSTRAINT fk_image_operation_product FOREIGN KEY (product_id, cafeteria_id)
    REFERENCES public.lunches(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT fk_image_operation_asset FOREIGN KEY (asset_id, product_id, cafeteria_id)
    REFERENCES public.catalog_image_assets(id, product_id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT ck_image_operation_result CHECK (
    (state = 'PROCESSING' AND applied_version IS NULL AND failure_status IS NULL AND failure_code IS NULL)
    OR (state = 'APPLIED' AND applied_version IS NOT NULL AND failure_status IS NULL AND failure_code IS NULL)
    OR (state = 'REJECTED' AND applied_version IS NULL AND failure_status IS NOT NULL AND failure_code IS NOT NULL))
);

CREATE INDEX idx_catalog_images_cleanup ON public.catalog_image_assets(cleanup_after, id)
  WHERE state IN ('UPLOADING','RETIRED','DELETING');
CREATE INDEX idx_catalog_image_operations_lease ON public.catalog_image_operations(lease_until)
  WHERE state = 'PROCESSING';

ALTER TABLE public.catalog_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_image_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalog_image_assets, public.catalog_image_operations FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_image_assets','catalog_image_operations'] LOOP
    FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated', c, t);
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL (image_asset_id) ON TABLE public.lunches FROM PUBLIC, anon, authenticated;
COMMIT;
