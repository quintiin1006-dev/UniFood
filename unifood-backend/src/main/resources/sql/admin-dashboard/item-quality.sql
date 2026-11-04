, per_order AS (
  SELECT e.event_type, e.id, e.total, count(i.id) AS items, sum(i.subtotal) AS item_value,
         bool_and(COALESCE(i.id IS NOT NULL AND i.cafeteria_id = e.cafeteria_id
           AND l.id IS NOT NULL AND l.cafeteria_id = e.cafeteria_id
           AND i.quantity > 0 AND i.unit_price > 0 AND i.subtotal >= 0
           AND i.unit_price::text NOT IN ('NaN','Infinity','-Infinity')
           AND i.subtotal::text NOT IN ('NaN','Infinity','-Infinity')
           AND i.subtotal = i.unit_price * i.quantity, false)) AS usable,
         bool_or(i.id IS NOT NULL AND (i.lunch_name IS NULL OR i.lunch_name !~ '[^[:space:]]')) AS missing_name
  FROM events e
  LEFT JOIN public.order_items i ON i.order_id = e.id
  LEFT JOIN public.lunches l ON l.id = i.lunch_id
  GROUP BY e.event_type, e.id, e.total
)
SELECT event_type, count(*) AS examined,
       count(*) FILTER (WHERE NOT usable) AS unusable,
       count(*) FILTER (WHERE usable AND total IS NOT NULL AND total >= 0
         AND total::text NOT IN ('NaN','Infinity','-Infinity')) AS reconcilable,
       count(*) FILTER (WHERE usable AND total IS NOT NULL AND total >= 0
         AND total::text NOT IN ('NaN','Infinity','-Infinity')
         AND total <> item_value) AS mismatched,
       count(*) FILTER (WHERE missing_name) AS missing_names
FROM per_order GROUP BY event_type
