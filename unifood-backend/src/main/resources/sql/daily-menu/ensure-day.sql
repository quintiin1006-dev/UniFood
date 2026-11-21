INSERT INTO public.daily_menu_days (cafeteria_id, business_date)
VALUES (?, ?)
ON CONFLICT (cafeteria_id, business_date) DO NOTHING
