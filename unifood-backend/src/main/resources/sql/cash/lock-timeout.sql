-- Fail fast (CASH_BUSY) instead of holding a delivery or another cashier for long.
SELECT set_config('lock_timeout', '3s', true)
