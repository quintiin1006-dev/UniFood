INSERT INTO public.lunches(cafeteria_id, name, description, price, category, image_url, stock, is_active)
VALUES (?, ?, ?, ?, CAST(? AS public.catalog_category), NULL, 0, true)
RETURNING id, name, description, price, category, image_url, image_asset_id, is_active, version
