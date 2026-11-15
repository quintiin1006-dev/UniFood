INSERT INTO public.cash_sessions
  (cafeteria_id, shift, business_date, sequence_number, opening_float, opened_by, opened_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING id
