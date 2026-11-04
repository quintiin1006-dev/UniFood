, facts AS (
  SELECT e.id AS order_id, e.event_at, i.id AS item_id, i.lunch_id,
         i.lunch_name, i.quantity, i.subtotal
  FROM events e JOIN public.order_items i ON i.order_id = e.id AND i.cafeteria_id = e.cafeteria_id
  WHERE e.event_type = :outcome
), totals AS (
  SELECT count(DISTINCT lunch_id) AS total_products, count(DISTINCT order_id) AS total_orders,
         coalesce(sum(quantity::numeric),0) AS total_units, coalesce(sum(subtotal),0) AS total_value
  FROM facts
), products AS (
  SELECT lunch_id, count(DISTINCT order_id) AS orders, sum(quantity::numeric) AS units, sum(subtotal) AS item_value
  FROM facts GROUP BY lunch_id
), names AS (
  SELECT DISTINCT ON (lunch_id) lunch_id, lunch_name
  FROM facts ORDER BY lunch_id, event_at DESC, order_id DESC, item_id DESC
), ranked AS (
  SELECT *, row_number() OVER (ORDER BY units DESC, orders DESC, lunch_id) AS position FROM products
)
SELECT t.*, r.lunch_id, r.orders, r.units, r.item_value,
       CASE WHEN n.lunch_name ~ '[^[:space:]]' THEN n.lunch_name ELSE NULL END AS historical_name
FROM totals t LEFT JOIN ranked r ON r.position <= :limit
LEFT JOIN names n ON n.lunch_id = r.lunch_id ORDER BY r.position
