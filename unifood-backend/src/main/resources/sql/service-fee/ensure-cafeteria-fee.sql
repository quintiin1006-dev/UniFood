-- The row exists from the first change on; a NULL fee is "uses the general one" and not audited.
INSERT INTO public.cafeteria_service_fee (cafeteria_id)
SELECT c.id FROM public.cafeterias c WHERE c.id = ?
ON CONFLICT (cafeteria_id) DO NOTHING
