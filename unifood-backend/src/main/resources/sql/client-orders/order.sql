SELECT o.id, o.status::text AS status, o.total, o.note, o.created_at, o.updated_at,
       o.called_at, o.reminder_count, o.last_reminded_at, o.delivered_at, o.not_collected_at,
       o.cancelled_at, o.cancellation_source, o.rejection_reason, o.requested_pickup_at,
       f.id AS cafeteria_id, f.name AS cafeteria_name
FROM public.orders o
JOIN public.cafeterias f ON f.id = o.cafeteria_id
WHERE o.id = ?
