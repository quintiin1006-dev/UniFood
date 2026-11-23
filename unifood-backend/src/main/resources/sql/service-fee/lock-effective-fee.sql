-- Same as effective-fee.sql inside the order's transaction: a change of the general fee waits.
SELECT COALESCE(c.fee_cop, g.fee_cop) AS fee
FROM public.service_fee_settings g
LEFT JOIN public.cafeteria_service_fee c ON c.cafeteria_id = ?
WHERE g.id
FOR SHARE OF g
