SELECT o.id, o.status::text AS status, o.total, o.created_at, f.name AS cafeteria_name,
       s.units, s.products, s.first_names, s.first_quantities
FROM public.orders o
JOIN public.cafeterias f ON f.id = o.cafeteria_id
CROSS JOIN LATERAL (
  SELECT coalesce(sum(p.quantity), 0)::int AS units,
         count(*)::int AS products,
         (array_agg(p.name ORDER BY p.name COLLATE "C", p.lunch_id))[1:2] AS first_names,
         (array_agg(p.quantity ORDER BY p.name COLLATE "C", p.lunch_id))[1:2] AS first_quantities
  FROM (
    SELECT i.lunch_id, min(i.lunch_name) AS name, sum(i.quantity)::int AS quantity
    FROM public.order_items i
    WHERE i.order_id = o.id
    GROUP BY i.lunch_id
  ) p
) s
WHERE o.client_id = ?
  AND (o.created_at, o.id) < (?::timestamptz, ?::uuid)
ORDER BY o.created_at DESC, o.id DESC
LIMIT ?
