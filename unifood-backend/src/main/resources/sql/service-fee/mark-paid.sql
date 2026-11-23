UPDATE public.service_fee_settlements
SET status = 'PAGADA', paid_at = ?, paid_by = ?, note = ?
WHERE cafeteria_id = ? AND period_month = ? AND status = 'PENDIENTE'
