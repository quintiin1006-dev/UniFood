-- The fee in force: the cafeteria's own value (0 included), or the general one when it has none.
SELECT COALESCE(c.fee_cop, g.fee_cop) AS fee
FROM public.service_fee_settings g
LEFT JOIN public.cafeteria_service_fee c ON c.cafeteria_id = ?
WHERE g.id
