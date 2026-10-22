SELECT l.id, l.name, l.description, l.price, l.category, l.image_url, l.is_active, l.version
FROM public.cafeterias c
LEFT JOIN public.lunches l ON l.cafeteria_id = c.id
WHERE c.id = ?
ORDER BY l.name COLLATE "C", l.id
