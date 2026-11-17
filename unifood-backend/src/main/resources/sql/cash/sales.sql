-- Delivered orders of the cafeteria in [from, to). orders.total is NUMERIC(12,2): the sum stays
-- exact and the cents check lets the close refuse instead of rounding.
SELECT COALESCE(sum(o.total), 0) AS amount,
       count(*) AS orders,
       COALESCE(bool_or(o.total <> trunc(o.total)), false) AS fractional
FROM public.orders o
WHERE o.cafeteria_id = ?
  AND o.status = 'DELIVERED'
  AND o.delivered_at >= ?
  AND o.delivered_at < ?
