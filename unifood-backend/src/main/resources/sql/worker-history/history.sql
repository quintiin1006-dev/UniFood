-- Page orders before joining their historical items: no split cards or N+1.
WITH completed_orders AS (
  (SELECT o.id, o.client_name, o.status, o.total, o.delivered_at AS completed_at
   FROM public.orders o
   WHERE o.cafeteria_id = :cafeteriaId AND o.status = 'DELIVERED'
     AND o.delivered_at >= :dayStart AND o.delivered_at < :nextDayStart
     AND (CAST(:status AS text) IS NULL OR o.status::text = :status)
     AND (o.delivered_at, o.id) < (CAST(:cursorAt AS timestamptz), CAST(:cursorId AS uuid))
     AND (:search = ''
       OR position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(o.client_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0
       OR position(:search IN ('pedido · ' || substring(replace(o.id::text, '-', ''), 1, 8))) > 0
       OR o.status::text IN (:searchStates)
       OR EXISTS (SELECT 1 FROM public.order_items s
                  WHERE s.order_id = o.id AND position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(s.lunch_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0))
   ORDER BY o.delivered_at DESC, o.id DESC LIMIT :limit)
  UNION ALL
  (SELECT o.id, o.client_name, o.status, o.total, o.not_collected_at AS completed_at
   FROM public.orders o
   WHERE o.cafeteria_id = :cafeteriaId AND o.status = 'NOT_COLLECTED'
     AND o.not_collected_at >= :dayStart AND o.not_collected_at < :nextDayStart
     AND (CAST(:status AS text) IS NULL OR o.status::text = :status)
     AND (o.not_collected_at, o.id) < (CAST(:cursorAt AS timestamptz), CAST(:cursorId AS uuid))
     AND (:search = ''
       OR position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(o.client_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0
       OR position(:search IN ('pedido · ' || substring(replace(o.id::text, '-', ''), 1, 8))) > 0
       OR o.status::text IN (:searchStates)
       OR EXISTS (SELECT 1 FROM public.order_items s
                  WHERE s.order_id = o.id AND position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(s.lunch_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0))
   ORDER BY o.not_collected_at DESC, o.id DESC LIMIT :limit)
  UNION ALL
  (SELECT o.id, o.client_name, o.status, o.total, o.cancelled_at AS completed_at
   FROM public.orders o
   WHERE o.cafeteria_id = :cafeteriaId AND o.status = 'CANCELLED'
     AND o.cancelled_at >= :dayStart AND o.cancelled_at < :nextDayStart
     AND (CAST(:status AS text) IS NULL OR o.status::text = :status)
     AND (o.cancelled_at, o.id) < (CAST(:cursorAt AS timestamptz), CAST(:cursorId AS uuid))
     AND (:search = ''
       OR position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(o.client_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0
       OR position(:search IN ('pedido · ' || substring(replace(o.id::text, '-', ''), 1, 8))) > 0
       OR o.status::text IN (:searchStates)
       OR EXISTS (SELECT 1 FROM public.order_items s
                  WHERE s.order_id = o.id AND position(:search IN lower(regexp_replace(normalize(regexp_replace(coalesce(s.lunch_name, ''), '[[:space:]]+', ' ', 'g'), NFD), U&'[\0300-\036f]', '', 'g'))) > 0))
   ORDER BY o.cancelled_at DESC, o.id DESC LIMIT :limit)
), page AS (
  SELECT * FROM completed_orders ORDER BY completed_at DESC, id DESC LIMIT :limit
), metadata AS (
  SELECT EXISTS (
    SELECT 1 FROM public.orders WHERE cafeteria_id = :cafeteriaId AND status = 'DELIVERED' AND delivered_at >= :monthStart AND delivered_at < :nextDayStart
    UNION ALL
    SELECT 1 FROM public.orders WHERE cafeteria_id = :cafeteriaId AND status = 'NOT_COLLECTED' AND not_collected_at >= :monthStart AND not_collected_at < :nextDayStart
    UNION ALL
    SELECT 1 FROM public.orders WHERE cafeteria_id = :cafeteriaId AND status = 'CANCELLED' AND cancelled_at >= :monthStart AND cancelled_at < :nextDayStart
  ) AS has_history
)
SELECT m.has_history, o.id, o.client_name, o.status, o.total, o.completed_at,
       i.id AS item_id, i.lunch_name AS item_name, i.quantity AS item_quantity,
       i.unit_price AS item_unit_price, i.subtotal AS item_subtotal
FROM metadata m
LEFT JOIN page o ON true
LEFT JOIN public.order_items i ON i.order_id = o.id
ORDER BY o.completed_at DESC, o.id DESC, i.id ASC
