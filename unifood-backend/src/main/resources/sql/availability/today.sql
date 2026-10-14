SELECT c.id AS cafeteria_id, c.name AS cafeteria_name, c.is_active AS cafeteria_active,
       COALESCE(s.is_open,false) AS is_open,
       l.id AS item_id, l.name, l.description, l.price, l.image_url, l.category,
       COALESCE(a.is_available,false) AS is_available
FROM public.cafeterias c
LEFT JOIN public.cafeteria_daily_states s ON s.cafeteria_id=c.id AND s.business_date=?
LEFT JOIN public.lunches l ON l.cafeteria_id=c.id AND l.is_active
LEFT JOIN public.daily_item_availability a
  ON a.item_id=l.id AND a.cafeteria_id=c.id AND a.business_date=?
WHERE c.id=?
ORDER BY l.name COLLATE "C",l.id
