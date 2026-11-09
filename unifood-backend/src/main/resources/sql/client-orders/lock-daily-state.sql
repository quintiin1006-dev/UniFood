SELECT is_open FROM public.cafeteria_daily_states
WHERE cafeteria_id = ? AND business_date = ?
FOR SHARE
