SELECT tolerance_cop, version
FROM public.cafeteria_cash_settings
WHERE cafeteria_id = ?
FOR UPDATE
