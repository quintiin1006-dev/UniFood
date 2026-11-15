import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

// Migration 028: cash sessions, movements, count lines and their append-only audit
// (docs/decisiones.md §14). Spring computes every amount; these tests prove the database
// rejects incoherent or late writes even when Spring is bypassed.
const migrations = new URL(
  "../../unifood-backend/supabase/migrations/",
  import.meta.url,
);
const FILE = "028_cash_sessions.sql";
const migration = (name) => readFile(new URL(name, migrations), "utf8");
const reverse = async () => {
  const text = (await migration(FILE)).split("-- Reverse")[1];
  return text
    .slice(text.indexOf("-- BEGIN;"))
    .split(/\r?\n/)
    .filter((line) => line.startsWith("-- ") && !line.startsWith("-- --"))
    .map((line) => line.slice(3))
    .join("\n");
};

const one = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];
const check = (name) => (error) =>
  error.code === "23514" &&
  (error.constraint === name || error.message.includes(name));
const unique = (name) => (error) =>
  error.code === "23505" &&
  (error.constraint === name || error.message.includes(name));

/** Through 024 (the last migration in develop), then 028 as staging will receive it. */
async function database() {
  const db = await createAuthDatabase({ throughMigration: "024" });
  return db;
}

async function world(db) {
  const institution = (
    await one(
      db,
      "SELECT id FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co'",
    )
  ).id;
  const site = (
    await one(
      db,
      `INSERT INTO public.sites (name, city, institution_id)
       VALUES ('Sede de prueba', 'Villavicencio', $1) RETURNING id`,
      [institution],
    )
  ).id;
  const cafeteria = async (name) =>
    (
      await one(
        db,
        `INSERT INTO public.cafeterias (site_id, name, is_active, lunch_order_start, lunch_order_end)
         VALUES ($1, $2, false, '06:00', '18:00') RETURNING id`,
        [site, name],
      )
    ).id;
  const worker = async (cafe) => {
    const user = (
      await one(db, "INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [
        `w-${Math.random()}@example.invalid`,
      ])
    ).id;
    await db.query(
      "INSERT INTO public.user_roles (user_id, role_id) SELECT $1, id FROM public.roles WHERE name::text = 'WORKER'",
      [user],
    );
    await db.query(
      "INSERT INTO public.cafeteria_users (user_id, cafeteria_id) VALUES ($1, $2)",
      [user, cafe],
    );
    await db.query("UPDATE public.users SET is_active = true WHERE id = $1", [
      user,
    ]);
    return user;
  };
  return { cafeteria, worker };
}

// 12:00 in Bogota on 2026-11-20.
const NOON = "2026-11-20T17:00:00Z";

async function open(db, cafe, user, overrides = {}) {
  const row = {
    shift: "LUNCH",
    business_date: "2026-11-20",
    sequence_number: 1,
    opening_float: 50000,
    opened_at: NOON,
    ...overrides,
  };
  return (
    await one(
      db,
      `INSERT INTO public.cash_sessions
         (cafeteria_id, shift, business_date, sequence_number, opening_float, opened_by, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        cafe,
        row.shift,
        row.business_date,
        row.sequence_number,
        row.opening_float,
        user,
        row.opened_at,
      ],
    )
  ).id;
}

/** Writes the count lines and closes with coherent figures (float 50.000 + sales). */
async function close(db, session, user, { sales = 0, counted, note = null }) {
  const expected = 50000 + sales;
  await db.query("DELETE FROM public.cash_count_lines WHERE session_id = $1", [
    session,
  ]);
  if (counted > 0)
    await db.query(
      "INSERT INTO public.cash_count_lines (session_id, denomination, quantity) VALUES ($1, 50, $2)",
      [session, counted / 50],
    );
  await db.query(
    `UPDATE public.cash_sessions
     SET status = 'CLOSED', closed_by = $2, closed_at = opened_at + interval '1 hour',
         sales_cash = $3::bigint, income_total = 0, expense_total = 0, expected_cash = $4::bigint,
         counted_cash = $5::bigint, difference = $5::bigint - $4::bigint, tolerance_cop = 2000,
         note = $6::text,
         pending_orders_at_close = 0, forced_close = false, version = version + 1
     WHERE id = $1`,
    [session, user, sales, expected, counted, note],
  );
}

test("028 re-applies over 022 with audit history and widens its CHECK idempotently", async (t) => {
  const db = await database();
  t.after(() => db.close());
  const { cafeteria } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  // A 022 audit row from before 028 (billing change made by SQL).
  await db.query(
    "UPDATE public.cafeteria_billing_settings SET billing_model = 'SUBSCRIPTION' WHERE cafeteria_id = $1",
    [cafe],
  );
  const before = Number(
    (await one(db, "SELECT count(*) AS n FROM public.cafeteria_settings_audit"))
      .n,
  );
  assert.ok(before >= 2);

  await db.exec(await migration(FILE));
  await db.exec(await migration(FILE)); // re-runnable

  assert.equal(
    Number(
      (
        await one(
          db,
          "SELECT count(*) AS n FROM public.cafeteria_settings_audit",
        )
      ).n,
    ),
    before,
    "re-applying keeps the 022 history and adds no audit rows",
  );
  const settings = await one(
    db,
    "SELECT tolerance_cop, last_sequence FROM public.cafeteria_cash_settings WHERE cafeteria_id = $1",
    [cafe],
  );
  assert.deepEqual(settings, { tolerance_cop: 2000, last_sequence: 0 });
  const constraints = await db.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.cafeteria_settings_audit'::regclass
       AND conname = 'cafeteria_settings_audit_setting_check'`,
  );
  assert.equal(constraints.rows.length, 1);
  assert.match(constraints.rows[0].def, /CASH_TOLERANCE/);

  // A new cafeteria gets its row; a tolerance change is audited as SQL; others still fail.
  const norte = await cafeteria("Cafetería Norte");
  await db.query(
    "UPDATE public.cafeteria_cash_settings SET tolerance_cop = 5000 WHERE cafeteria_id = $1",
    [norte],
  );
  const audit = await one(
    db,
    "SELECT setting, old_value, new_value, source, changed_by FROM public.cafeteria_settings_audit WHERE cafeteria_id = $1 AND setting = 'CASH_TOLERANCE'",
    [norte],
  );
  assert.deepEqual(audit, {
    setting: "CASH_TOLERANCE",
    old_value: { toleranceCop: 2000 },
    new_value: { toleranceCop: 5000 },
    source: "SQL",
    changed_by: null,
  });
  await assert.rejects(
    db.query(
      "INSERT INTO public.cafeteria_settings_audit (cafeteria_id, setting, old_value, new_value, source) VALUES ($1, 'OTHER', '{}', '{}', 'SQL')",
      [norte],
    ),
    check("cafeteria_settings_audit_setting_check"),
  );
  await assert.rejects(
    db.query(
      "UPDATE public.cafeteria_cash_settings SET tolerance_cop = -1 WHERE cafeteria_id = $1",
      [norte],
    ),
    check("chk_cafeteria_cash_tolerance"),
  );
  await assert.rejects(
    db.query(
      "DELETE FROM public.cafeteria_cash_settings WHERE cafeteria_id = $1",
      [norte],
    ),
    check("cash_record_append_only"),
  );
});

test("028 business date is the Bogota day of the opening, at the midnight edge", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria, worker } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  const user = await worker(cafe);
  // 23:59:59 in Bogota on the 20th is 04:59:59Z on the 21st.
  await assert.rejects(
    open(db, cafe, user, {
      business_date: "2026-11-21",
      opened_at: "2026-11-21T04:59:59Z",
    }),
    check("chk_cash_session_business_date"),
  );
  const late = await open(db, cafe, user, {
    business_date: "2026-11-20",
    opened_at: "2026-11-21T04:59:59Z",
  });
  await close(db, late, user, { counted: 50000 });
  // 00:00:00 in Bogota on the 21st belongs to the 21st.
  await assert.rejects(
    open(db, cafe, user, {
      business_date: "2026-11-20",
      opened_at: "2026-11-21T05:00:00Z",
      shift: "BREAKFAST",
      sequence_number: 2,
    }),
    check("chk_cash_session_business_date"),
  );
  await open(db, cafe, user, {
    business_date: "2026-11-21",
    opened_at: "2026-11-21T05:00:00Z",
    shift: "BREAKFAST",
    sequence_number: 2,
  });
});

test("028 allows one open drawer per cafeteria and one session per shift and day", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria, worker } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  const other = await cafeteria("Cafetería Norte");
  const user = await worker(cafe);
  const otherUser = await worker(other);
  const first = await open(db, cafe, user, { shift: "BREAKFAST" });
  await assert.rejects(
    open(db, cafe, user, { shift: "LUNCH", sequence_number: 2 }),
    unique("uq_cash_session_one_open"),
  );
  // Another cafeteria is independent.
  await open(db, other, otherUser, { shift: "BREAKFAST" });
  await close(db, first, user, { counted: 50000 });
  await assert.rejects(
    open(db, cafe, user, { shift: "BREAKFAST", sequence_number: 2 }),
    unique("uq_cash_session_shift"),
  );
  await assert.rejects(
    open(db, cafe, user, { shift: "LUNCH", sequence_number: 1 }),
    unique("uq_cash_session_sequence"),
  );
  await open(db, cafe, user, { shift: "LUNCH", sequence_number: 2 });
});

test("028 closing CHECKs: coherent expected and difference, note when it does not balance, lines add up", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria, worker } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  const user = await worker(cafe);
  const session = await open(db, cafe, user);
  await assert.rejects(
    close(db, session, user, { counted: 49000 }),
    check("chk_cash_session_note"),
  );
  await assert.rejects(
    close(db, session, user, { counted: 49000, note: "corto" }),
    check("chk_cash_session_note"),
  );
  // The failed closes above left their count lines (separate statements): start clean.
  await db.query("DELETE FROM public.cash_count_lines WHERE session_id = $1", [
    session,
  ]);
  await assert.rejects(
    db.query(
      `UPDATE public.cash_sessions SET status = 'CLOSED', closed_by = $2, closed_at = now(),
         sales_cash = 0, income_total = 0, expense_total = 0, expected_cash = 50000,
         counted_cash = 0, difference = 1, tolerance_cop = 2000,
         pending_orders_at_close = 0, forced_close = false, note = 'Diferencia de prueba'
       WHERE id = $1`,
      [session, user],
    ),
    check("chk_cash_session_difference"),
  );
  await assert.rejects(
    db.query(
      `UPDATE public.cash_sessions SET status = 'CLOSED', closed_by = $2, closed_at = now(),
         sales_cash = 0, income_total = 0, expense_total = 0, expected_cash = 0,
         counted_cash = 0, difference = 0, tolerance_cop = 2000,
         pending_orders_at_close = 0, forced_close = false
       WHERE id = $1`,
      [session, user],
    ),
    check("chk_cash_session_expected"),
  );
  // Counted 50.000 without lines does not add up.
  await assert.rejects(
    db.query(
      `UPDATE public.cash_sessions SET status = 'CLOSED', closed_by = $2, closed_at = now(),
         sales_cash = 0, income_total = 0, expense_total = 0, expected_cash = 50000,
         counted_cash = 50000, difference = 0, tolerance_cop = 2000,
         pending_orders_at_close = 0, forced_close = false
       WHERE id = $1`,
      [session, user],
    ),
    check("cash_session_count_mismatch"),
  );
  await assert.rejects(
    db.query(
      "INSERT INTO public.cash_count_lines (session_id, denomination, quantity) VALUES ($1, 3000, 1)",
      [session],
    ),
    check("chk_cash_count_denomination"),
  );
  await close(db, session, user, {
    counted: 48500,
    note: "Faltan 1.500 por un vuelto mal dado",
  });
  const closed = await one(
    db,
    "SELECT status, difference FROM public.cash_sessions WHERE id = $1",
    [session],
  );
  assert.deepEqual(closed, { status: "CLOSED", difference: -1500 });
});

test("028 a closed session is immutable; only a reopen with a reason changes it", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria, worker } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  const user = await worker(cafe);
  const session = await open(db, cafe, user);
  await db.query(
    "INSERT INTO public.cash_movements (session_id, request_id, kind, amount, reason, created_by, created_at) VALUES ($1, gen_random_uuid(), 'EXPENSE', 10000, 'Compra de hielo', $2, now())",
    [session, user],
  );
  await assert.rejects(
    db.query(
      "UPDATE public.cash_movements SET amount = 1 WHERE session_id = $1",
      [session],
    ),
    check("cash_record_append_only"),
  );
  await assert.rejects(
    db.query("DELETE FROM public.cash_movements WHERE session_id = $1", [
      session,
    ]),
    check("cash_record_append_only"),
  );
  await close(db, session, user, { counted: 50000 });

  const forbidden = [
    "UPDATE public.cash_sessions SET note = 'Nota cambiada después' WHERE id = $1",
    "UPDATE public.cash_sessions SET status = 'OPEN', closed_by = NULL, closed_at = NULL, sales_cash = NULL, income_total = NULL, expense_total = NULL, expected_cash = NULL, counted_cash = NULL, difference = NULL, tolerance_cop = NULL, pending_orders_at_close = NULL, forced_close = NULL WHERE id = $1",
    "UPDATE public.cash_sessions SET opening_float = 1 WHERE id = $1",
    "UPDATE public.cash_count_lines SET quantity = 0 WHERE session_id = $1",
    "DELETE FROM public.cash_count_lines WHERE session_id = $1",
  ];
  for (const sql of forbidden)
    await assert.rejects(
      db.query(sql, [session]),
      (error) => error.code === "23514",
      sql,
    );
  await assert.rejects(
    db.query(
      "INSERT INTO public.cash_movements (session_id, request_id, kind, amount, reason, created_by, created_at) VALUES ($1, gen_random_uuid(), 'INCOME', 1000, 'Tarde', $2, now())",
      [session, user],
    ),
    check("cash_session_closed_immutable"),
  );
  await assert.rejects(
    db.query("DELETE FROM public.cash_sessions WHERE id = $1", [session]),
    check("cash_record_append_only"),
  );
  await assert.rejects(
    db.query("TRUNCATE public.cash_sessions CASCADE"),
    (error) => error.code === "23514",
  );

  // Reopen: status, reopen data and cleared figures in one UPDATE.
  await assert.rejects(
    db.query(
      `UPDATE public.cash_sessions SET status = 'REOPENED', reopen_count = 1, reopened_by = $2,
         reopened_at = now(), reopen_reason = 'corto', closed_by = NULL, closed_at = NULL,
         sales_cash = NULL, income_total = NULL, expense_total = NULL, expected_cash = NULL,
         counted_cash = NULL, difference = NULL, tolerance_cop = NULL, note = NULL,
         pending_orders_at_close = NULL, forced_close = NULL WHERE id = $1`,
      [session, user],
    ),
    check("chk_cash_session_reopen"),
  );
  await db.query("SELECT set_config('unifood.actor_id', $1, false)", [user]);
  await db.query(
    `UPDATE public.cash_sessions SET status = 'REOPENED', reopen_count = 1, reopened_by = $2,
       reopened_at = now(), reopen_reason = 'Faltó registrar un retiro', closed_by = NULL,
       closed_at = NULL, sales_cash = NULL, income_total = NULL, expense_total = NULL,
       expected_cash = NULL, counted_cash = NULL, difference = NULL, tolerance_cop = NULL,
       note = NULL, pending_orders_at_close = NULL, forced_close = NULL, version = version + 1
     WHERE id = $1`,
    [session, user],
  );
  await db.query("SELECT set_config('unifood.actor_id', '', false)");
  const history = await db.query(
    "SELECT action, source, old_value, new_value FROM public.cash_sessions_audit WHERE session_id = $1 ORDER BY id",
    [session],
  );
  assert.deepEqual(
    history.rows.map((r) => `${r.action}/${r.source}`),
    ["OPENED/SQL", "MOVEMENT/SQL", "CLOSED/SQL", "REOPENED/API"],
  );
  const reopened = history.rows[3];
  assert.equal(reopened.old_value.status, "CLOSED");
  assert.equal(reopened.old_value.counted_cash, 50000);
  assert.deepEqual(reopened.old_value.countLines, [
    { denomination: 50, quantity: 1000 },
  ]);
  assert.equal(reopened.new_value.status, "REOPENED");
  assert.equal(history.rows[2].new_value.countLines.length, 1);
  assert.equal(history.rows[2].old_value.countLines, undefined);
});

test("028 audit is append-only and every table is closed to the browser", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria, worker } = await world(db);
  const cafe = await cafeteria("Cafetería Central");
  const user = await worker(cafe);
  await open(db, cafe, user);
  for (const sql of [
    "UPDATE public.cash_sessions_audit SET source = 'SQL'",
    "DELETE FROM public.cash_sessions_audit",
    "TRUNCATE public.cash_sessions_audit",
  ])
    await assert.rejects(
      db.query(sql),
      check("cash_sessions_audit_immutable"),
      sql,
    );
  const tables = [
    "cafeteria_cash_settings",
    "cash_sessions",
    "cash_movements",
    "cash_count_lines",
    "cash_sessions_audit",
  ];
  for (const table of tables) {
    const row = await one(
      db,
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated
       FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`,
      [table],
    );
    assert.deepEqual(
      row,
      { rls: true, anon: false, authenticated: false },
      table,
    );
  }
});

test("028 reverse script removes the cash objects and keeps the wider audit CHECK", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await db.exec(await reverse());
  const left = await one(
    db,
    `SELECT count(*) AS n FROM pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relname IN ('cash_sessions', 'cash_movements', 'cash_count_lines',
                       'cash_sessions_audit', 'cafeteria_cash_settings')`,
  );
  assert.equal(Number(left.n), 0);
  const fns = await one(
    db,
    "SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE '%cash%'",
  );
  assert.equal(Number(fns.n), 0);
  // And 028 applies again after its reverse.
  await db.exec(await migration(FILE));
});
