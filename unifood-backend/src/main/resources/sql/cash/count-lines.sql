SELECT denomination, quantity FROM public.cash_count_lines
WHERE session_id = ? ORDER BY denomination DESC
