SELECT COALESCE(max(sequence_number), 0) FROM public.cash_sessions WHERE cafeteria_id = ?
