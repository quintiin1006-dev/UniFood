WITH completed_orders AS (
  SELECT id, client_name, status, total, delivered_at AS completed_at
  FROM public.orders
  WHERE cafeteria_id = :cafeteriaId AND status = 'DELIVERED'
    AND delivered_at >= :dayStart AND delivered_at < :nextDayStart
  UNION ALL
  SELECT id, client_name, status, total, not_collected_at AS completed_at
  FROM public.orders
  WHERE cafeteria_id = :cafeteriaId AND status = 'NOT_COLLECTED'
    AND not_collected_at >= :dayStart AND not_collected_at < :nextDayStart
  UNION ALL
  SELECT id, client_name, status, total, cancelled_at AS completed_at
  FROM public.orders
  WHERE cafeteria_id = :cafeteriaId AND status = 'CANCELLED'
    AND cancelled_at >= :dayStart AND cancelled_at < :nextDayStart
)
SELECT o.id, o.client_name, o.status, o.total, o.completed_at,
       i.id AS item_id, i.lunch_name AS item_name, i.quantity AS item_quantity,
       i.unit_price AS item_unit_price, i.subtotal AS item_subtotal
FROM completed_orders o
LEFT JOIN public.order_items i ON i.order_id = o.id
ORDER BY o.completed_at DESC, o.id DESC, i.id ASC
