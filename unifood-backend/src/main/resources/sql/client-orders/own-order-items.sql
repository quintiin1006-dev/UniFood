SELECT i.lunch_name, i.quantity, i.unit_price, i.subtotal
FROM public.order_items i
JOIN public.orders o ON o.id = i.order_id
JOIN public.clients c ON c.id = o.client_id
WHERE i.order_id = ? AND c.user_id = ?
ORDER BY i.lunch_name COLLATE "C", i.lunch_id
