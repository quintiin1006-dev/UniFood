INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available)
VALUES (?,?,?,?)
ON CONFLICT (item_id,business_date) DO UPDATE
  SET is_available=EXCLUDED.is_available,updated_at=clock_timestamp()
RETURNING cafeteria_id,item_id,business_date,is_available,created_at,updated_at
