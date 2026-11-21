SELECT a.id, a.name, v.extra_price
FROM public.daily_menu_addition_availability v
JOIN public.daily_menu_additions a ON a.id = v.addition_id AND a.cafeteria_id = v.cafeteria_id
WHERE v.cafeteria_id = ? AND v.business_date = ? AND v.is_available AND a.active
ORDER BY lower(a.name), a.id
