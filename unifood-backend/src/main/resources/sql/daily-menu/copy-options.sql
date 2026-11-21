INSERT INTO public.daily_menu_options (cafeteria_id, business_date, category_id, label, created_at)
SELECT o.cafeteria_id, ?, o.category_id, o.label, clock_timestamp()
FROM (
  SELECT * FROM public.daily_menu_options
  WHERE cafeteria_id = ? AND business_date = ? AND category_id = ?
  ORDER BY created_at, id
) o
