UPDATE public.service_fee_settings
SET fee_cop = ?, version = version + 1, updated_at = ?, updated_by = ?
WHERE id AND version = ?
