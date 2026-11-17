SELECT EXISTS (SELECT 1 FROM public.cash_sessions
               WHERE cafeteria_id = ? AND business_date = ? AND shift = ?)
