UPDATE public.daily_item_availability SET is_available = false, updated_at = clock_timestamp()
WHERE cafeteria_id = ? AND item_id = ? AND business_date = ? AND is_available
