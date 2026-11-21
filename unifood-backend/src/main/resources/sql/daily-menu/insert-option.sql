-- clock_timestamp(), not now(): options keep the order the worker wrote them in.
INSERT INTO public.daily_menu_options (cafeteria_id, business_date, category_id, label, created_at)
VALUES (?, ?, ?, ?, clock_timestamp())
