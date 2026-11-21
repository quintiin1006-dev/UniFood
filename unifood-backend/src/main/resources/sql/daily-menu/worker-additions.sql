-- Active catalog additions with that day's state. The frozen price applies while switched on.
SELECT a.id, a.name,
       CASE WHEN COALESCE(v.is_available, false) THEN v.extra_price ELSE a.extra_price END AS extra_price,
       COALESCE(v.is_available, false) AS available
FROM public.daily_menu_additions a
LEFT JOIN public.daily_menu_addition_availability v
  ON v.addition_id = a.id AND v.business_date = ?
WHERE a.cafeteria_id = ? AND a.active
ORDER BY lower(a.name), a.id
