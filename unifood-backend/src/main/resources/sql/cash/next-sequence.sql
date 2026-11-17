UPDATE public.cafeteria_cash_settings
SET last_sequence = last_sequence + 1
WHERE cafeteria_id = ?
RETURNING last_sequence
