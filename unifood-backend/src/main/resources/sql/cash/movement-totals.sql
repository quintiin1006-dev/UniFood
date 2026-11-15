SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'INCOME'), 0) AS income,
       COALESCE(sum(amount) FILTER (WHERE kind = 'EXPENSE'), 0) AS expense
FROM public.cash_movements
WHERE session_id = ?
