-- Only the caller's own unread notices; already read rows are left as they are.
UPDATE public.order_notices SET read_at = ? WHERE user_id = ? AND read_at IS NULL
