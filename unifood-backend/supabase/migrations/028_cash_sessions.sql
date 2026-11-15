BEGIN;

-- Cash register sessions per cafeteria and shift (docs/decisiones.md §14). Internal control
-- for a cash-only cafeteria: it does not replace invoicing. Whole COP in bigint; the server
-- computes every amount, and the database checks they are coherent.
--
-- Expected cash = opening float + delivered sales in the session window + income - expenses.
-- Difference = counted - expected. A closed session is immutable: only an ADMIN reopens it,
-- with a reason, and the previous version stays in cash_sessions_audit (append-only).
--
-- Re-runnable: every object uses IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS.

-- No cafeteria may be created between the seed and the trigger that gives it its cash row.
LOCK TABLE public.cafeterias IN SHARE ROW EXCLUSIVE MODE;

-- One row per cafeteria: the ADMIN's tolerance and the receipt sequence. Locking this row
-- serializes open, close and reopen of a cafeteria (lock order: this row, the session, orders).
CREATE TABLE IF NOT EXISTS public.cafeteria_cash_settings (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  tolerance_cop integer NOT NULL DEFAULT 2000,
  last_sequence integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cafeteria_cash_tolerance CHECK (tolerance_cop BETWEEN 0 AND 1000000),
  CONSTRAINT chk_cafeteria_cash_sequence CHECK (last_sequence >= 0),
  CONSTRAINT chk_cafeteria_cash_version CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  shift text NOT NULL,
  business_date date NOT NULL,
  sequence_number integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  opening_float bigint NOT NULL,
  opened_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL,
  closed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  sales_cash bigint,
  income_total bigint,
  expense_total bigint,
  expected_cash bigint,
  counted_cash bigint,
  difference bigint,
  tolerance_cop integer,
  note text,
  pending_orders_at_close integer,
  forced_close boolean,
  reopen_count integer NOT NULL DEFAULT 0,
  reopened_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  reopened_at timestamptz,
  reopen_reason text,
  version integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_cash_session_shift CHECK (shift IN ('BREAKFAST', 'LUNCH')),
  CONSTRAINT chk_cash_session_status CHECK (status IN ('OPEN', 'CLOSED', 'REOPENED')),
  CONSTRAINT chk_cash_session_sequence CHECK (sequence_number >= 1),
  CONSTRAINT chk_cash_session_version CHECK (version >= 0),
  CONSTRAINT chk_cash_session_float CHECK (opening_float BETWEEN 0 AND 100000000),
  -- The business date is the Bogota calendar day of the opening, whatever the server zone.
  CONSTRAINT chk_cash_session_business_date
    CHECK (business_date = (opened_at AT TIME ZONE 'America/Bogota')::date),
  -- Every closing figure exists exactly when the session is CLOSED.
  CONSTRAINT chk_cash_session_closed_fields CHECK (
    (status = 'CLOSED') = (closed_by IS NOT NULL AND closed_at IS NOT NULL
                           AND sales_cash IS NOT NULL AND income_total IS NOT NULL
                           AND expense_total IS NOT NULL AND expected_cash IS NOT NULL
                           AND counted_cash IS NOT NULL AND difference IS NOT NULL
                           AND tolerance_cop IS NOT NULL AND pending_orders_at_close IS NOT NULL
                           AND forced_close IS NOT NULL)
    AND (status = 'CLOSED' OR (closed_by IS NULL AND closed_at IS NULL AND sales_cash IS NULL
                               AND income_total IS NULL AND expense_total IS NULL
                               AND expected_cash IS NULL AND counted_cash IS NULL
                               AND difference IS NULL AND tolerance_cop IS NULL AND note IS NULL
                               AND pending_orders_at_close IS NULL AND forced_close IS NULL))),
  CONSTRAINT chk_cash_session_window CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT chk_cash_session_amounts CHECK (
    (sales_cash IS NULL OR sales_cash >= 0)
    AND (income_total IS NULL OR income_total >= 0)
    AND (expense_total IS NULL OR expense_total >= 0)
    AND (counted_cash IS NULL OR counted_cash BETWEEN 0 AND 1000000000)
    AND (tolerance_cop IS NULL OR tolerance_cop BETWEEN 0 AND 1000000)
    AND (pending_orders_at_close IS NULL OR pending_orders_at_close >= 0)),
  CONSTRAINT chk_cash_session_expected CHECK (
    expected_cash IS NULL
    OR (expected_cash = opening_float + sales_cash + income_total - expense_total
        AND expected_cash >= 0)),
  CONSTRAINT chk_cash_session_difference CHECK (
    difference IS NULL OR difference = counted_cash - expected_cash),
  -- Any difference needs an explanation of at least 10 characters.
  CONSTRAINT chk_cash_session_note CHECK (
    (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 10 AND 500))
    AND (difference IS NULL OR difference = 0 OR note IS NOT NULL)),
  -- Only an ADMIN close may leave READY or CALLED orders behind.
  CONSTRAINT chk_cash_session_forced CHECK (
    forced_close IS NULL OR forced_close = (pending_orders_at_close > 0)),
  CONSTRAINT chk_cash_session_reopen CHECK (
    reopen_count >= 0
    AND (reopen_count = 0) = (reopened_by IS NULL AND reopened_at IS NULL AND reopen_reason IS NULL)
    AND (reopen_reason IS NULL
         OR (reopen_reason = btrim(reopen_reason) AND char_length(reopen_reason) BETWEEN 10 AND 300))
    AND (status <> 'REOPENED' OR reopen_count > 0)),
  CONSTRAINT uq_cash_session_sequence UNIQUE (cafeteria_id, sequence_number),
  -- One session per cafeteria, shift and Bogota day; a closed one is reopened, never repeated.
  CONSTRAINT uq_cash_session_shift UNIQUE (cafeteria_id, business_date, shift)
);

-- A single open drawer per cafeteria at a time, so a delivered order counts in one session only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_one_open
  ON public.cash_sessions (cafeteria_id) WHERE status IN ('OPEN', 'REOPENED');

CREATE INDEX IF NOT EXISTS idx_cash_sessions_cafeteria_date
  ON public.cash_sessions (cafeteria_id, business_date DESC, sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_window
  ON public.cash_sessions (cafeteria_id, opened_at);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  amount bigint NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  CONSTRAINT chk_cash_movement_kind CHECK (kind IN ('INCOME', 'EXPENSE')),
  CONSTRAINT chk_cash_movement_amount CHECK (amount BETWEEN 1 AND 100000000),
  CONSTRAINT chk_cash_movement_reason
    CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session
  ON public.cash_movements (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.cash_count_lines (
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  denomination integer NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (session_id, denomination),
  -- Colombian bills 50.000 to 2.000 and coins 1.000 to 50.
  CONSTRAINT chk_cash_count_denomination
    CHECK (denomination IN (50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50)),
  CONSTRAINT chk_cash_count_quantity CHECK (quantity BETWEEN 0 AND 10000)
);

CREATE TABLE IF NOT EXISTS public.cash_sessions_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('OPENED', 'MOVEMENT', 'CLOSED', 'REOPENED')),
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('API', 'SQL')),
  CONSTRAINT chk_cash_sessions_audit_author CHECK ((source = 'API') = (changed_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_audit_session
  ON public.cash_sessions_audit (session_id, changed_at, id);

-- The tolerance is audited with the other cafeteria settings of 022. Dropping and re-adding
-- the CHECK keeps this re-runnable on a database that already has 022 (or this migration).
ALTER TABLE public.cafeteria_settings_audit
  DROP CONSTRAINT IF EXISTS cafeteria_settings_audit_setting_check;
ALTER TABLE public.cafeteria_settings_audit
  ADD CONSTRAINT cafeteria_settings_audit_setting_check
  CHECK (setting IN ('VISIBILITY', 'BILLING', 'CASH_TOLERANCE'));

-- Every existing cafeteria gets the default tolerance; no audit row for the default.
INSERT INTO public.cafeteria_cash_settings (cafeteria_id)
SELECT c.id FROM public.cafeterias c
ON CONFLICT (cafeteria_id) DO NOTHING;

-- ---------------------------------------------------------------- functions

-- Session, with its count lines when asked, as stored in the audit. No version counter.
CREATE OR REPLACE FUNCTION public.cash_session_snapshot(
  session public.cash_sessions, with_lines boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (to_jsonb(session) - 'version')
         || CASE WHEN NOT with_lines THEN '{}'::jsonb ELSE jsonb_build_object('countLines', COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('denomination', l.denomination,
                                                   'quantity', l.quantity)
                                ORDER BY l.denomination DESC)
               FROM public.cash_count_lines l WHERE l.session_id = session.id),
              '[]'::jsonb)) END
$$;

CREATE OR REPLACE FUNCTION public.audit_cash_session()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
  source text := CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cash_sessions_audit
      (session_id, cafeteria_id, action, old_value, new_value, changed_by, source)
    VALUES (NEW.id, NEW.cafeteria_id, 'OPENED', '{}'::jsonb,
            public.cash_session_snapshot(NEW, false), actor, source);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('CLOSED', 'REOPENED') THEN
    INSERT INTO public.cash_sessions_audit
      (session_id, cafeteria_id, action, old_value, new_value, changed_by, source)
    VALUES (NEW.id, NEW.cafeteria_id, NEW.status,
            -- A close writes its lines just before the UPDATE, so only a reopen's old side
            -- (the closed version being replaced) carries them.
            public.cash_session_snapshot(OLD, NEW.status = 'REOPENED'),
            public.cash_session_snapshot(NEW, NEW.status = 'CLOSED'), actor, source);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.audit_cash_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
BEGIN
  INSERT INTO public.cash_sessions_audit
    (session_id, cafeteria_id, action, old_value, new_value, changed_by, source)
  SELECT NEW.session_id, s.cafeteria_id, 'MOVEMENT', '{}'::jsonb, to_jsonb(NEW), actor,
         CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END
  FROM public.cash_sessions s WHERE s.id = NEW.session_id;
  RETURN NULL;
END $$;

-- What may change in a session. A CLOSED one only becomes REOPENED (with a new reason);
-- its identity, window start and float never change, and closing checks the count lines.
CREATE OR REPLACE FUNCTION public.guard_cash_session_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  counted bigint;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.cafeteria_id IS DISTINCT FROM OLD.cafeteria_id
     OR NEW.shift IS DISTINCT FROM OLD.shift
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
     OR NEW.opening_float IS DISTINCT FROM OLD.opening_float
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'Cash session identity and opening are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_opening_immutable';
  END IF;
  IF OLD.status = 'CLOSED' AND (NEW.status <> 'REOPENED'
                                OR NEW.reopen_count <> OLD.reopen_count + 1) THEN
    RAISE EXCEPTION 'A closed cash session is immutable; an ADMIN reopens it with a reason'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  IF OLD.status <> 'CLOSED' AND NEW.status = 'REOPENED' AND OLD.status <> 'REOPENED' THEN
    RAISE EXCEPTION 'Only a closed cash session can be reopened'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  IF OLD.status <> 'CLOSED' AND NEW.reopen_count <> OLD.reopen_count THEN
    RAISE EXCEPTION 'Only a reopen changes the reopen data'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  IF NEW.status = 'CLOSED' AND OLD.status <> 'CLOSED' THEN
    SELECT COALESCE(sum(l.denomination::bigint * l.quantity), 0) INTO counted
    FROM public.cash_count_lines l WHERE l.session_id = NEW.id;
    IF counted IS DISTINCT FROM NEW.counted_cash THEN
      RAISE EXCEPTION 'Counted cash must equal the sum of the count lines'
        USING ERRCODE = '23514', CONSTRAINT = 'cash_session_count_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.reject_cash_record_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Cash records are never deleted'
    USING ERRCODE = '23514', CONSTRAINT = 'cash_record_append_only';
END $$;

-- Movements are append-only and only enter an open session. FOR SHARE waits for a close that
-- holds the session, so a movement never lands in a session that is closing.
CREATE OR REPLACE FUNCTION public.guard_cash_movement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Cash movements are append-only'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_record_append_only';
  END IF;
  SELECT s.status INTO current_status FROM public.cash_sessions s
  WHERE s.id = NEW.session_id FOR SHARE;
  IF current_status IS DISTINCT FROM 'OPEN' AND current_status IS DISTINCT FROM 'REOPENED' THEN
    RAISE EXCEPTION 'Movements only enter an open cash session'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  RETURN NEW;
END $$;

-- Count lines change only while the session is open (the close writes them, then closes).
CREATE OR REPLACE FUNCTION public.guard_cash_count_line()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
  current_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'Count lines stay in their session'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  SELECT s.status INTO current_status FROM public.cash_sessions s
  WHERE s.id = target FOR SHARE;
  IF current_status IS DISTINCT FROM 'OPEN' AND current_status IS DISTINCT FROM 'REOPENED' THEN
    RAISE EXCEPTION 'Count lines of a closed cash session are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_session_closed_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION public.reject_cash_sessions_audit_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Cash sessions audit is append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'cash_sessions_audit_immutable';
END $$;

CREATE OR REPLACE FUNCTION public.audit_cafeteria_cash_tolerance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := public.cafeteria_settings_actor();
BEGIN
  IF NEW.tolerance_cop IS DISTINCT FROM OLD.tolerance_cop THEN
    INSERT INTO public.cafeteria_settings_audit
      (cafeteria_id, setting, old_value, new_value, changed_by, source)
    VALUES (NEW.cafeteria_id, 'CASH_TOLERANCE',
            jsonb_build_object('toleranceCop', OLD.tolerance_cop),
            jsonb_build_object('toleranceCop', NEW.tolerance_cop),
            actor, CASE WHEN actor IS NULL THEN 'SQL' ELSE 'API' END);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_cash_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.cafeteria_cash_settings (cafeteria_id) VALUES (NEW.id)
  ON CONFLICT (cafeteria_id) DO NOTHING;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------- triggers

DROP TRIGGER IF EXISTS trg_cafeterias_cash_settings_row ON public.cafeterias;
CREATE TRIGGER trg_cafeterias_cash_settings_row
  AFTER INSERT ON public.cafeterias
  FOR EACH ROW EXECUTE FUNCTION public.create_cafeteria_cash_settings();

DROP TRIGGER IF EXISTS trg_cafeteria_cash_tolerance_audit ON public.cafeteria_cash_settings;
CREATE TRIGGER trg_cafeteria_cash_tolerance_audit
  AFTER UPDATE OF tolerance_cop ON public.cafeteria_cash_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_cash_tolerance();

DROP TRIGGER IF EXISTS trg_cafeteria_cash_settings_no_delete ON public.cafeteria_cash_settings;
CREATE TRIGGER trg_cafeteria_cash_settings_no_delete
  BEFORE DELETE ON public.cafeteria_cash_settings
  FOR EACH ROW EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cafeteria_cash_settings_no_truncate ON public.cafeteria_cash_settings;
CREATE TRIGGER trg_cafeteria_cash_settings_no_truncate
  BEFORE TRUNCATE ON public.cafeteria_cash_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cash_session_guard ON public.cash_sessions;
CREATE TRIGGER trg_cash_session_guard
  BEFORE UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_session_update();

DROP TRIGGER IF EXISTS trg_cash_session_audit ON public.cash_sessions;
CREATE TRIGGER trg_cash_session_audit
  AFTER INSERT OR UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.audit_cash_session();

DROP TRIGGER IF EXISTS trg_cash_session_no_delete ON public.cash_sessions;
CREATE TRIGGER trg_cash_session_no_delete
  BEFORE DELETE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cash_session_no_truncate ON public.cash_sessions;
CREATE TRIGGER trg_cash_session_no_truncate
  BEFORE TRUNCATE ON public.cash_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cash_movement_guard ON public.cash_movements;
CREATE TRIGGER trg_cash_movement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_movement();

DROP TRIGGER IF EXISTS trg_cash_movement_audit ON public.cash_movements;
CREATE TRIGGER trg_cash_movement_audit
  AFTER INSERT ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.audit_cash_movement();

DROP TRIGGER IF EXISTS trg_cash_movement_no_truncate ON public.cash_movements;
CREATE TRIGGER trg_cash_movement_no_truncate
  BEFORE TRUNCATE ON public.cash_movements
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cash_count_line_guard ON public.cash_count_lines;
CREATE TRIGGER trg_cash_count_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_count_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_count_line();

DROP TRIGGER IF EXISTS trg_cash_count_line_no_truncate ON public.cash_count_lines;
CREATE TRIGGER trg_cash_count_line_no_truncate
  BEFORE TRUNCATE ON public.cash_count_lines
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cash_record_delete();

DROP TRIGGER IF EXISTS trg_cash_sessions_audit_immutable ON public.cash_sessions_audit;
CREATE TRIGGER trg_cash_sessions_audit_immutable
  BEFORE UPDATE OR DELETE ON public.cash_sessions_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_cash_sessions_audit_change();

DROP TRIGGER IF EXISTS trg_cash_sessions_audit_no_truncate ON public.cash_sessions_audit;
CREATE TRIGGER trg_cash_sessions_audit_no_truncate
  BEFORE TRUNCATE ON public.cash_sessions_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cash_sessions_audit_change();

COMMENT ON TABLE public.cafeteria_cash_settings IS
  'Cash tolerance (audited in cafeteria_settings_audit) and receipt sequence per cafeteria.';
COMMENT ON TABLE public.cash_sessions IS
  'Cash register session per cafeteria, shift and Bogota day. Internal control, not invoicing.';
COMMENT ON TABLE public.cash_movements IS 'Append-only income and expenses of a cash session.';
COMMENT ON TABLE public.cash_count_lines IS 'Closing count by denomination of a cash session.';
COMMENT ON TABLE public.cash_sessions_audit IS
  'Append-only audit of cash sessions, written by trigger.';

-- Business tables stay closed to the browser: only Spring (service connection) reads them.
ALTER TABLE public.cafeteria_cash_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cafeteria_cash_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cash_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cash_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cash_count_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cash_sessions_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cash_sessions_audit_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cash_session_snapshot(public.cash_sessions, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cash_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cash_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_cash_session_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cash_record_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_cash_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_cash_count_line() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cash_sessions_audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_cash_tolerance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cafeteria_cash_settings() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse (deletes every cash session, movement, count and their audit). The CASH_TOLERANCE
-- rows of cafeteria_settings_audit are append-only and stay, so its wider CHECK stays too.
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_cafeterias_cash_settings_row ON public.cafeterias;
-- DROP FUNCTION IF EXISTS public.cash_session_snapshot(public.cash_sessions, boolean);
-- DROP TABLE IF EXISTS public.cash_sessions_audit;
-- DROP TABLE IF EXISTS public.cash_count_lines;
-- DROP TABLE IF EXISTS public.cash_movements;
-- DROP TABLE IF EXISTS public.cash_sessions;
-- DROP TABLE IF EXISTS public.cafeteria_cash_settings;
-- DROP FUNCTION IF EXISTS public.create_cafeteria_cash_settings();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_cash_tolerance();
-- DROP FUNCTION IF EXISTS public.reject_cash_sessions_audit_change();
-- DROP FUNCTION IF EXISTS public.guard_cash_count_line();
-- DROP FUNCTION IF EXISTS public.guard_cash_movement();
-- DROP FUNCTION IF EXISTS public.reject_cash_record_delete();
-- DROP FUNCTION IF EXISTS public.guard_cash_session_update();
-- DROP FUNCTION IF EXISTS public.audit_cash_movement();
-- DROP FUNCTION IF EXISTS public.audit_cash_session();
-- COMMIT;
