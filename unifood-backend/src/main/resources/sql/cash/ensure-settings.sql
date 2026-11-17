INSERT INTO public.cafeteria_cash_settings (cafeteria_id) VALUES (?)
ON CONFLICT (cafeteria_id) DO NOTHING
