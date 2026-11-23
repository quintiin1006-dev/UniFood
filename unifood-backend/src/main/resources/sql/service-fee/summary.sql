-- Live, read-only: DELIVERED orders of the month of delivered_at in America/Bogota (033).
SELECT delivered_orders_count, products_total, fee_total
FROM public.service_fee_month_summary(?, ?)
