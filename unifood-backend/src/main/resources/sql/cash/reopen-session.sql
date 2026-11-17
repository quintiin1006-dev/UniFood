-- The closed version stays in cash_sessions_audit (trigger of 028); the figures are cleared
-- here and recomputed at the next close, with the window extended until then.
UPDATE public.cash_sessions
SET status = 'REOPENED', reopen_count = reopen_count + 1, reopened_by = ?, reopened_at = ?,
    reopen_reason = ?, closed_by = NULL, closed_at = NULL, sales_cash = NULL,
    income_total = NULL, expense_total = NULL, expected_cash = NULL, counted_cash = NULL,
    difference = NULL, tolerance_cop = NULL, note = NULL, pending_orders_at_close = NULL,
    forced_close = NULL, version = version + 1
WHERE id = ? AND version = ? AND status = 'CLOSED'
