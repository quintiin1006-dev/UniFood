SELECT lunch_name, quantity, unit_price, subtotal FROM public.order_items
WHERE order_id = ?
ORDER BY lunch_name COLLATE "C", lunch_id
