BEGIN;

-- Push notifications to the phone (docs/notificaciones-push.md). One row per device and browser
-- (endpoint) that a signed-in client or worker registered. The in-app notice stays the primary
-- channel: a missing or revoked row only means no push, never a failed order transition.
--
-- channel is the delivery channel. Only WEB_PUSH (PWA + VAPID) is implemented now. FCM (a future
-- native app) fits this same structure: its token goes in endpoint and p256dh/auth stay NULL, so
-- adding it needs no structural migration, only widening chk_push_subscriptions_channel if a
-- third channel ever appears.
--
-- user_id and role come from the authenticated user as the backend resolves it from the
-- database; cafeteria_id is the worker's cafeteria from cafeteria_users, NULL for clients.
-- The browser never chooses any of them. The table is closed to the browser: RLS on, no grants.
--
-- revoked_at marks a subscription that must not be used again: the push service answered 404 or
-- 410, the user turned notifications off or signed out, or the device limit replaced it.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  cafeteria_id uuid REFERENCES public.cafeterias(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'WEB_PUSH',
  endpoint text NOT NULL,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_channel'
  ) THEN
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_channel
      CHECK (channel IN ('WEB_PUSH', 'FCM'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_role'
  ) THEN
    -- A worker subscription is always tied to its cafeteria; a client one never is.
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_role
      CHECK (
        (role = 'CLIENT' AND cafeteria_id IS NULL)
        OR (role = 'WORKER' AND cafeteria_id IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_endpoint'
  ) THEN
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_endpoint
      CHECK (
        char_length(endpoint) BETWEEN 1 AND 2048
        AND (channel <> 'WEB_PUSH' OR endpoint ~ '^https://[^[:space:]]+$')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_keys'
  ) THEN
    -- Web Push needs the browser's P-256 key (65 bytes, 87 chars base64url) and the 16-byte
    -- auth secret (22 chars). The limits leave room for padding without accepting large blobs.
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_keys
      CHECK (
        (p256dh IS NULL OR p256dh ~ '^[A-Za-z0-9_=-]{1,128}$')
        AND (auth IS NULL OR auth ~ '^[A-Za-z0-9_=-]{1,64}$')
        AND (channel <> 'WEB_PUSH' OR (p256dh IS NOT NULL AND auth IS NOT NULL))
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_user_agent'
  ) THEN
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_user_agent
      CHECK (user_agent IS NULL OR char_length(user_agent) <= 256);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'chk_push_subscriptions_dates'
  ) THEN
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT chk_push_subscriptions_dates
      CHECK (last_seen_at >= created_at AND (revoked_at IS NULL OR revoked_at >= created_at));
  END IF;
END;
$$;

-- The client's active devices, and the workers of one cafeteria, are the two lookups per push.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON public.push_subscriptions (user_id, created_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_cafeteria_active
  ON public.push_subscriptions (cafeteria_id, role)
  WHERE revoked_at IS NULL AND cafeteria_id IS NOT NULL;

COMMENT ON TABLE public.push_subscriptions IS
  'Devices registered for push notifications. Server-only; the backend sends, the browser never reads it.';
COMMENT ON COLUMN public.push_subscriptions.channel IS
  'Delivery channel: WEB_PUSH now; FCM reserved for a future native app.';
COMMENT ON COLUMN public.push_subscriptions.revoked_at IS
  'Set when the push service answers 404/410, the user turns push off or signs out, or the device limit replaces it.';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Closed to every API role, rebuilt from nothing on every run like 024. The backend reaches the
-- table through its own database connection, never through PostgREST.
DO $block$
DECLARE
  grantee text;
BEGIN
  EXECUTE 'REVOKE ALL ON public.push_subscriptions FROM PUBLIC';
  FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = grantee) THEN
      EXECUTE format('REVOKE ALL ON public.push_subscriptions FROM %I', grantee);
    END IF;
  END LOOP;
END;
$block$;

COMMIT;

-- Reverse (run by hand only if this migration must be undone; it drops every registered device):
--
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_push_subscriptions_cafeteria_active;
-- DROP INDEX IF EXISTS public.idx_push_subscriptions_user_active;
-- DROP TABLE IF EXISTS public.push_subscriptions;
-- COMMIT;
