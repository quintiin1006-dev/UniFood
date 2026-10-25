-- Shared CTE: only bounded candidates; no customer fields or all-history scans.
WITH candidates AS (
  SELECT o.id, o.cafeteria_id, o.status, o.total, o.created_at,
         o.delivered_at, o.not_collected_at, o.cancelled_at,
         'RECEIVED' AS event_type, o.created_at AS event_at
  FROM public.orders o
  WHERE o.cafeteria_id = :cafeteriaId
    AND o.created_at >= :start AND o.created_at < :end
  UNION ALL
  SELECT o.id, o.cafeteria_id, o.status, o.total, o.created_at,
         o.delivered_at, o.not_collected_at, o.cancelled_at,
         'DELIVERED', o.delivered_at
  FROM public.orders o
  WHERE o.cafeteria_id = :cafeteriaId
    AND o.delivered_at >= :start AND o.delivered_at < :end
  UNION ALL
  SELECT o.id, o.cafeteria_id, o.status, o.total, o.created_at,
         o.delivered_at, o.not_collected_at, o.cancelled_at,
         'NOT_COLLECTED', o.not_collected_at
  FROM public.orders o
  WHERE o.cafeteria_id = :cafeteriaId
    AND o.not_collected_at >= :start AND o.not_collected_at < :end
), classified AS (
  SELECT *, COALESCE(isfinite(created_at) AND isfinite(event_at)
    AND (event_type = 'RECEIVED' OR (
      status::text = event_type AND event_at >= created_at
      AND num_nonnulls(delivered_at, not_collected_at, cancelled_at) = 1
    )), false) AS eligible
  FROM candidates
), events AS (
  SELECT * FROM classified WHERE eligible
)
