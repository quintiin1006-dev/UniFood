SELECT 'RECORDED_TERMINAL_EVENTS' AS basis,
       count(DISTINCT id) AS examined,
       count(DISTINCT id) FILTER (WHERE NOT eligible) AS affected
FROM classified WHERE event_type <> 'RECEIVED'
UNION ALL
SELECT 'CREATED_COHORT', count(*), count(*) FILTER (WHERE NOT COALESCE(
  CASE status::text
    WHEN 'DELIVERED' THEN isfinite(delivered_at) AND delivered_at >= created_at AND delivered_at <= :asOf
      AND not_collected_at IS NULL AND cancelled_at IS NULL
    WHEN 'NOT_COLLECTED' THEN isfinite(not_collected_at) AND not_collected_at >= created_at AND not_collected_at <= :asOf
      AND delivered_at IS NULL AND cancelled_at IS NULL
    WHEN 'CANCELLED' THEN isfinite(cancelled_at) AND cancelled_at >= created_at AND cancelled_at <= :asOf
      AND delivered_at IS NULL AND not_collected_at IS NULL
    ELSE num_nonnulls(delivered_at, not_collected_at, cancelled_at) = 0
  END, false))
FROM classified WHERE event_type = 'RECEIVED'
