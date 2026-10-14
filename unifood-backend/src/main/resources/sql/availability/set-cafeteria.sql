INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open)
VALUES (?,?,?)
ON CONFLICT (cafeteria_id,business_date) DO UPDATE
  SET is_open=EXCLUDED.is_open,updated_at=clock_timestamp()
RETURNING cafeteria_id,business_date,is_open,created_at,updated_at
