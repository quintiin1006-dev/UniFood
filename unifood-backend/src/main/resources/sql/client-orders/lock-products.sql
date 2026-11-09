SELECT id, name, price, is_active FROM public.lunches
WHERE cafeteria_id = ? AND id = ANY(?)
ORDER BY id
FOR SHARE
