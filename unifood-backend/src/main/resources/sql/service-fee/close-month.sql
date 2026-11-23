-- Freezes the summary once: a second close finds the row and inserts nothing.
INSERT INTO public.service_fee_settlements
  (cafeteria_id, period_month, delivered_orders_count, products_total, fee_total, created_by)
SELECT ?, ?, s.delivered_orders_count, s.products_total, s.fee_total, ?
FROM public.service_fee_month_summary(?, ?) s
ON CONFLICT (cafeteria_id, period_month) DO NOTHING
