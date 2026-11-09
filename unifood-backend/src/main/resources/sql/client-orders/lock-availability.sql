SELECT item_id, is_available FROM public.daily_item_availability
WHERE cafeteria_id = ? AND business_date = ? AND item_id = ANY(?)
ORDER BY item_id
FOR SHARE
