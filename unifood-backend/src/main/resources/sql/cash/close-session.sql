UPDATE public.cash_sessions
SET status = 'CLOSED', closed_by = ?, closed_at = ?, sales_cash = ?, income_total = ?,
    expense_total = ?, expected_cash = ?, counted_cash = ?, difference = ?, tolerance_cop = ?,
    note = ?, pending_orders_at_close = ?, forced_close = ?, version = version + 1
WHERE id = ? AND version = ? AND status IN ('OPEN', 'REOPENED')
