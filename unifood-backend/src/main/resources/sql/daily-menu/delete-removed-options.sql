-- Options no longer in the list. Kept ones keep their id, so a client's choice survives the edit.
DELETE FROM public.daily_menu_options
WHERE cafeteria_id = ? AND business_date = ? AND category_id = ?
  AND NOT (label_key = ANY (SELECT lower(btrim(x)) FROM unnest(?::text[]) AS x))
