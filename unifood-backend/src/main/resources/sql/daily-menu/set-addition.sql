-- On: the price is copied only when it was not already on. Off: the copied price stays.
INSERT INTO public.daily_menu_addition_availability
    (cafeteria_id, business_date, addition_id, is_available, extra_price)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (addition_id, business_date) DO UPDATE
SET is_available = EXCLUDED.is_available,
    extra_price = CASE
      WHEN EXCLUDED.is_available AND NOT daily_menu_addition_availability.is_available
        THEN EXCLUDED.extra_price
      ELSE daily_menu_addition_availability.extra_price END,
    updated_at = now()
