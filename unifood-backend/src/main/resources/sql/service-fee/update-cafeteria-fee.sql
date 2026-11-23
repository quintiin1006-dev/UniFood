UPDATE public.cafeteria_service_fee
SET fee_cop = ?, version = version + 1, updated_at = ?, updated_by = ?
WHERE cafeteria_id = ? AND version = ?
