-- clock_timestamp(): the choices are read back in the order they were written.
INSERT INTO public.order_daily_menu_choices
    (order_id, cafeteria_id, line_kind, category_id, category_label, option_label, extra_price,
     source_option_id, source_addition_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, clock_timestamp())
