UPDATE public.cafeteria_cash_settings
SET tolerance_cop = ?, version = version + 1, updated_at = ?, updated_by = ?
WHERE cafeteria_id = ? AND version = ?
