SELECT l.id, l.name, l.description, l.price, l.category::text AS category,
       COALESCE(a.is_available, false) AS is_available
FROM public.lunches l
LEFT JOIN public.daily_item_availability a
  ON a.item_id = l.id AND a.cafeteria_id = l.cafeteria_id AND a.business_date = ?
WHERE l.cafeteria_id = ? AND l.is_active
ORDER BY l.name COLLATE "C", l.id
