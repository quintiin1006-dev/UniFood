UPDATE public.cafeteria_billing_settings
SET billing_model = ?,
    per_order_fee_cop = ?,
    subscription_fee_cop = ?,
    version = version + 1,
    updated_at = ?,
    updated_by = ?
WHERE cafeteria_id = ?
  AND version = ?
