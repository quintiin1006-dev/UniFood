UPDATE public.lunches SET name = ?, description = ?, price = ?, category = CAST(? AS public.catalog_category)
WHERE cafeteria_id = ? AND id = ? AND version = ?
RETURNING id, name, description, price, category, image_url, is_active, version
