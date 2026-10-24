SELECT id, name, description, price, category, image_url, image_asset_id, is_active, version FROM public.lunches WHERE cafeteria_id = ? AND id = ? FOR UPDATE
