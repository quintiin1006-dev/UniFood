SELECT (event_at AT TIME ZONE 'America/Bogota')::date AS day, event_type,
       count(*) AS orders,
       count(*) FILTER (WHERE total IS NULL OR total < 0 OR total::text IN ('NaN','Infinity','-Infinity')) AS invalid_amounts,
       CASE WHEN bool_and(total IS NOT NULL AND total >= 0 AND total::text NOT IN ('NaN','Infinity','-Infinity'))
            THEN sum(total) ELSE NULL END AS value
FROM events GROUP BY day, event_type ORDER BY day, event_type
