UPDATE public.lunches SET is_active = ?
WHERE cafeteria_id = ? AND id = ? AND version = ?
RETURNING id, name, description, price, category, image_url, is_active, version
