SELECT cafeteria_id, period_month, delivered_orders_count, products_total, fee_total, status,
       paid_at, note, created_at
FROM public.service_fee_settlements
WHERE cafeteria_id = ? AND period_month = ?
