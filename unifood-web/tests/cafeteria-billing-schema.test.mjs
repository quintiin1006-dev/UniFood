import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

// Migration 022: visibility stays in cafeterias.is_active, billing gets its own table, and
// every change of either is audited by trigger (docs/decisiones.md §5 and §10).
const migrations = new URL(
  "../../unifood-backend/supabase/migrations/",
  import.meta.url,
);
const scripts = new URL("../../scripts/supabase/", import.meta.url);
const FILE = "022_cafeteria_visibility_billing.sql";
const migration = (name) => readFile(new URL(name, migrations), "utf8");
const reverse = async () =>
  (await migration(FILE))
    .split("-- Reverse:")[1]
    .split(/\r?\n/)
    .filter((line) => line.startsWith("-- "))
    .map((line) => line.slice(3))
    .join("\n");

const one = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];
const check = (name) => (error) =>
  error.code === "23514" &&
  (error.constraint === name || error.message.includes(name));

/** Applies 001-021 and 023, then 022: the real order on staging (022 out of order). */
async function outOfOrder() {
  const db = await createAuthDatabase({ throughMigration: "021" });
  await db.exec(await migration("023_order_requested_pickup_time.sql"));
  return db;
}

/** Everything 022 could add or change in the public schema, without data. */
const schema = (db) =>
  db.query(`
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(obj_description(c.oid, 'pg_class'), '') AS item
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
    UNION ALL SELECT 'fn ' || p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    UNION ALL SELECT 'trg ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'auth.%'
    UNION ALL SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname || ' ' || coalesce(col_description(a.attrelid, a.attnum), '')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY 1`);

// One site with a cafeteria that has an active ADMIN (visible) and one without (hidden).
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
  const staff = async (role, cafe, email) => {
    const user = (
      await one(db, "INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [
        email,
      ])
    ).id;
    await db.query(
      "INSERT INTO public.user_roles (user_id, role_id) SELECT $1, id FROM public.roles WHERE name::text = $2",
      [user, role],
    );
    if (cafe)
      await db.query(
        "INSERT INTO public.cafeteria_users (user_id, cafeteria_id) VALUES ($1, $2)",
        [user, cafe],
      );
    await db.query("UPDATE public.users SET is_active = true WHERE id = $1", [
      user,
    ]);
    return user;
  };
  const central = await cafeteria("Cafetería Central");
  const norte = await cafeteria("Cafetería Norte");
  await db.exec("BEGIN");
  await staff("ADMIN", central, "admin@example.invalid");
  await db.query(
    "UPDATE public.cafeterias SET is_active = true WHERE id = $1",
    [central],
  );
  await db.exec("COMMIT");
  const superAdmin = await staff("SUPER_ADMIN", null, "super@example.invalid");
  return { site, central, norte, superAdmin, cafeteria };
}

const audit = async (db, cafeteria) =>
  (
    await db.query(
      `SELECT setting, old_value, new_value, changed_by, source
       FROM public.cafeteria_settings_audit WHERE cafeteria_id = $1 ORDER BY id`,
      [cafeteria],
    )
  ).rows;

test("022 applies after 023, seeds NONE for every cafeteria and keeps is_active", async (t) => {
  const db = await outOfOrder();
  t.after(() => db.close());
  // Data from before 022: one visible and one hidden cafeteria.
  const { central, norte } = await world(db);
  const before = await schema(db);
  await db.exec(await migration(FILE));
  assert.deepEqual(
    (
      await db.query(
        `SELECT c.name, c.is_active, b.billing_model, b.per_order_fee_cop, b.subscription_fee_cop,
                b.version, b.updated_by
         FROM public.cafeterias c JOIN public.cafeteria_billing_settings b ON b.cafeteria_id = c.id
         ORDER BY c.name`,
      )
    ).rows,
    [
      {
        name: "Cafetería Central",
        is_active: true,
        billing_model: "NONE",
        per_order_fee_cop: null,
        subscription_fee_cop: null,
        version: 0,
        updated_by: null,
      },
      {
        name: "Cafetería Norte",
        is_active: false,
        billing_model: "NONE",
        per_order_fee_cop: null,
        subscription_fee_cop: null,
        version: 0,
        updated_by: null,
      },
    ],
  );
  // The seed is not a change: nothing is audited for existing cafeterias.
  assert.deepEqual(await audit(db, central), []);
  assert.deepEqual(await audit(db, norte), []);

  // Running it again changes nothing, neither schema nor data.
  const applied = await schema(db);
  const data = async () =>
    (
      await db.query(
        `SELECT (SELECT jsonb_agg(to_jsonb(b) ORDER BY cafeteria_id) FROM public.cafeteria_billing_settings b)::text AS billing,
                (SELECT count(*) FROM public.cafeteria_settings_audit) AS audit`,
      )
    ).rows;
  const seeded = await data();
  await db.exec(await migration(FILE));
  assert.deepEqual(await schema(db), applied);
  assert.deepEqual(await data(), seeded);

  // The Reverse block leaves the schema exactly as before 022.
  await db.exec(await reverse());
  assert.deepEqual(await schema(db), before);
  assert.equal(
    (
      await one(db, "SELECT is_active FROM public.cafeterias WHERE id = $1", [
        central,
      ])
    ).is_active,
    true,
  );
});

test("022 billing CHECKs: whole pesos, fee only with PER_ORDER_FEE, monthly amount only with SUBSCRIPTION", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { central } = await world(db);
  const set = (model, perOrder, subscription) =>
    db.query(
      `UPDATE public.cafeteria_billing_settings
       SET billing_model = $2, per_order_fee_cop = $3, subscription_fee_cop = $4
       WHERE cafeteria_id = $1`,
      [central, model, perOrder, subscription],
    );
  for (const [model, perOrder, subscription] of [
    ["NONE", null, null],
    ["SUBSCRIPTION", null, null],
    ["SUBSCRIPTION", null, 1],
    ["SUBSCRIPTION", null, 100000000],
    ["PER_ORDER_FEE", 1, null],
    ["PER_ORDER_FEE", 1000000, null],
  ])
    await set(model, perOrder, subscription);
  for (const [model, perOrder, subscription, constraint] of [
    ["PER_ORDER_FEE", null, null, "chk_cafeteria_billing_fee"],
    ["PER_ORDER_FEE", 0, null, "chk_cafeteria_billing_fee"],
    ["PER_ORDER_FEE", 1000001, null, "chk_cafeteria_billing_fee"],
    ["NONE", 1000, null, "chk_cafeteria_billing_fee"],
    ["SUBSCRIPTION", 1000, null, "chk_cafeteria_billing_fee"],
    ["SUBSCRIPTION", null, 0, "chk_cafeteria_billing_subscription_fee"],
    ["SUBSCRIPTION", null, 100000001, "chk_cafeteria_billing_subscription_fee"],
    ["NONE", null, 50000, "chk_cafeteria_billing_subscription_fee"],
    ["PER_ORDER_FEE", 1000, 50000, "chk_cafeteria_billing_subscription_fee"],
    ["PERCENT", null, null, "chk_cafeteria_billing_model"],
  ])
    await assert.rejects(
      set(model, perOrder, subscription),
      check(constraint),
      `${model} ${perOrder} ${subscription}`,
    );
  await assert.rejects(
    db.query(
      "UPDATE public.cafeteria_billing_settings SET version = -1 WHERE cafeteria_id = $1",
      [central],
    ),
    check("chk_cafeteria_billing_version"),
  );
  // A fee with cents is not a peso amount the column can hold.
  await assert.rejects(
    db.query(
      "UPDATE public.cafeteria_billing_settings SET billing_model = 'PER_ORDER_FEE', per_order_fee_cop = '1000.5' WHERE cafeteria_id = $1",
      [central],
    ),
  );
});

test("022 gives every new cafeteria its NONE row, audited as a SQL change", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { cafeteria } = await world(db);
  const sur = await cafeteria("Cafetería Sur");
  assert.equal(
    (
      await one(
        db,
        "SELECT billing_model FROM public.cafeteria_billing_settings WHERE cafeteria_id = $1",
        [sur],
      )
    ).billing_model,
    "NONE",
  );
  assert.deepEqual(await audit(db, sur), [
    {
      setting: "BILLING",
      old_value: {},
      new_value: {
        model: "NONE",
        perOrderFeeCop: null,
        subscriptionFeeCop: null,
      },
      changed_by: null,
      source: "SQL",
    },
  ]);
  // The row cannot go away, and neither can a cafeteria that has one.
  const required = check("cafeteria_billing_settings_required");
  await assert.rejects(
    db.query(
      "DELETE FROM public.cafeteria_billing_settings WHERE cafeteria_id = $1",
      [sur],
    ),
    required,
  );
  await assert.rejects(
    db.exec("TRUNCATE public.cafeteria_billing_settings"),
    required,
  );
  await assert.rejects(
    db.query("DELETE FROM public.cafeterias WHERE id = $1", [sur]),
    (error) => ["23001", "23503"].includes(error.code),
  );
});

test("022 audits API and SQL changes in the same transaction, and nothing for a no-op", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { central, superAdmin } = await world(db);
  const before = (await audit(db, central)).length;

  // API: Spring sets unifood.actor_id with SET LOCAL inside its transaction.
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('unifood.actor_id', $1, true)", [
      superAdmin,
    ]);
    await tx.query(
      `UPDATE public.cafeteria_billing_settings
       SET billing_model = 'SUBSCRIPTION', subscription_fee_cop = 250000, version = version + 1
       WHERE cafeteria_id = $1`,
      [central],
    );
    await tx.query(
      "UPDATE public.cafeterias SET is_active = false WHERE id = $1",
      [central],
    );
  });
  // SET LOCAL ended with the transaction: the next change is manual SQL.
  await db.query(
    `UPDATE public.cafeteria_billing_settings
     SET billing_model = 'PER_ORDER_FEE', per_order_fee_cop = 1000, subscription_fee_cop = NULL
     WHERE cafeteria_id = $1`,
    [central],
  );
  // No-ops write nothing: same visibility, same billing (version or date alone is not a change).
  await db.query(
    "UPDATE public.cafeterias SET is_active = false, name = name WHERE id = $1",
    [central],
  );
  await db.query(
    "UPDATE public.cafeteria_billing_settings SET version = version + 1, updated_at = now() WHERE cafeteria_id = $1",
    [central],
  );
  // A failed transaction leaves no audit behind.
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "UPDATE public.cafeteria_billing_settings SET billing_model = 'NONE', per_order_fee_cop = NULL WHERE cafeteria_id = $1",
        [central],
      );
      await tx.query("SELECT 1 / 0");
    }),
  );
  assert.deepEqual((await audit(db, central)).slice(before), [
    {
      setting: "BILLING",
      old_value: {
        model: "NONE",
        perOrderFeeCop: null,
        subscriptionFeeCop: null,
      },
      new_value: {
        model: "SUBSCRIPTION",
        perOrderFeeCop: null,
        subscriptionFeeCop: 250000,
      },
      changed_by: superAdmin,
      source: "API",
    },
    {
      setting: "VISIBILITY",
      old_value: { visible: true },
      new_value: { visible: false },
      changed_by: superAdmin,
      source: "API",
    },
    {
      setting: "BILLING",
      old_value: {
        model: "SUBSCRIPTION",
        perOrderFeeCop: null,
        subscriptionFeeCop: 250000,
      },
      new_value: {
        model: "PER_ORDER_FEE",
        perOrderFeeCop: 1000,
        subscriptionFeeCop: null,
      },
      changed_by: null,
      source: "SQL",
    },
  ]);
});

test("022 audit is append-only: no UPDATE, DELETE or TRUNCATE, not even by the owner", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { central } = await world(db);
  await db.query(
    "UPDATE public.cafeterias SET is_active = false WHERE id = $1",
    [central],
  );
  const recorded = (await audit(db, central)).length;
  const immutable = check("cafeteria_settings_audit_immutable");
  await assert.rejects(
    db.query(
      "UPDATE public.cafeteria_settings_audit SET source = 'API', changed_by = NULL",
    ),
    immutable,
  );
  await assert.rejects(
    db.query("UPDATE public.cafeteria_settings_audit SET new_value = '{}'"),
    immutable,
  );
  await assert.rejects(
    db.query("DELETE FROM public.cafeteria_settings_audit"),
    immutable,
  );
  await assert.rejects(
    db.exec("TRUNCATE public.cafeteria_settings_audit"),
    immutable,
  );
  assert.equal((await audit(db, central)).length, recorded);
});

test("022 tables, sequence and functions stay closed to browser roles, even with Supabase defaults", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "000" });
  t.after(() => db.close());
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
  for (const name of (await readdir(migrations))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(await migration(name));
  for (const role of ["anon", "authenticated"]) {
    for (const table of [
      "public.cafeteria_billing_settings",
      "public.cafeteria_settings_audit",
    ]) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ])
        assert.equal(
          (
            await one(db, "SELECT has_table_privilege($1, $2, $3) AS ok", [
              role,
              table,
              privilege,
            ])
          ).ok,
          false,
          `${role} ${privilege} ${table}`,
        );
      for (const privilege of ["SELECT", "INSERT", "UPDATE"])
        assert.equal(
          (
            await one(db, "SELECT has_any_column_privilege($1, $2, $3) AS ok", [
              role,
              table,
              privilege,
            ])
          ).ok,
          false,
        );
    }
    assert.equal(
      (
        await one(
          db,
          "SELECT has_sequence_privilege($1, 'public.cafeteria_settings_audit_id_seq', 'USAGE') AS ok",
          [role],
        )
      ).ok,
      false,
    );
    for (const fn of [
      "public.cafeteria_settings_actor()",
      "public.cafeteria_billing_value(text, integer, integer)",
      "public.audit_cafeteria_visibility()",
      "public.audit_cafeteria_billing()",
      "public.reject_cafeteria_settings_audit_change()",
      "public.reject_cafeteria_billing_delete()",
      "public.create_cafeteria_billing_settings()",
    ])
      assert.equal(
        (
          await one(
            db,
            "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok",
            [role, fn],
          )
        ).ok,
        false,
        `${role} EXECUTE ${fn}`,
      );
    for (const table of [
      "cafeteria_billing_settings",
      "cafeteria_settings_audit",
    ])
      assert.equal(
        (
          await one(
            db,
            "SELECT relrowsecurity AS ok FROM pg_class WHERE oid = $1::regclass",
            [`public.${table}`],
          )
        ).ok,
        true,
      );
  }
});

test("the migration registry detects 022 and staging-check reports its objects", async (t) => {
  const bootstrap = await readFile(
    new URL("bootstrap-schema-migrations.sql", scripts),
    "utf8",
  );
  const registry = async (db) =>
    (await db.exec(bootstrap))
      .find((result) => result.fields.some((field) => field.name === "source"))
      .rows.map((row) => row.version);
  const without = await outOfOrder();
  t.after(() => without.close());
  const versions = await registry(without);
  assert.ok(versions.includes("023"));
  assert.ok(!versions.includes("022"));
  const full = await createAuthDatabase();
  t.after(() => full.close());
  assert.ok((await registry(full)).includes("022"));

  const staging = await readFile(new URL("staging-check.sql", scripts), "utf8");
  // Only the rows of the 022 block.
  const rows = async (db) =>
    (await db.exec(staging))
      .filter((result) => result.fields.some((field) => field.name === "ok"))
      .flatMap((result) => result.rows)
      .filter((row) => String(row.object).startsWith("022"));
  const fresh = await outOfOrder();
  t.after(() => fresh.close());
  const missing = (await rows(fresh))
    .filter((row) => !row.ok)
    .map((row) => row.object);
  assert.ok(missing.length === 5, missing.join(", "));
  const after = await createAuthDatabase();
  t.after(() => after.close());
  await world(after);
  assert.deepEqual(
    (await rows(after)).filter((row) => !row.ok),
    [],
  );
});

test(
  "native PostgreSQL: 022 applies after 023, repeats without effect, audits and rolls back",
  { timeout: 120000 },
  async (t) => {
    const binaries = await postgresBinaries();
    if (!binaries) return t.skip("Native PostgreSQL is not installed");
    const db = await createNativeAuthDatabase(binaries, {
      throughMigration: "021",
    });
    t.after(() => db.close());
    await db.query(await migration("023_order_requested_pickup_time.sql"));
    await db.query(`
      INSERT INTO public.sites (name, city, institution_id)
        SELECT 'Sede', 'Villavicencio', id FROM public.institutions
        WHERE email_domain = 'ustavillavo.edu.co';
      INSERT INTO public.cafeterias (site_id, name, is_active, lunch_order_start, lunch_order_end)
        SELECT id, 'Cafetería', false, '06:00', '18:00' FROM public.sites;`);
    await db.query(await migration(FILE));
    await db.query(await migration(FILE));
    assert.equal(
      await db.query(
        "SELECT count(*) || ' ' || min(billing_model) FROM public.cafeteria_billing_settings",
      ),
      "1 NONE",
    );
    assert.equal(
      await db.query("SELECT count(*) FROM public.cafeteria_settings_audit"),
      "0",
    );
    const super_ = await db.query(`
      INSERT INTO auth.users(email) VALUES ('super@example.invalid');
      INSERT INTO public.user_roles (user_id, role_id)
        SELECT u.id, r.id FROM public.users u, public.roles r WHERE r.name::text = 'SUPER_ADMIN';
      UPDATE public.users SET is_active = true;
      SELECT id FROM public.users;`);
    const id = super_.split(/\r?\n/).at(-1);
    await db.query(`
      BEGIN;
      SELECT set_config('unifood.actor_id', '${id}', true);
      UPDATE public.cafeteria_billing_settings
        SET billing_model = 'PER_ORDER_FEE', per_order_fee_cop = 1000, version = version + 1;
      COMMIT;`);
    // A failure later in the transaction takes its audit row with it.
    await assert.rejects(
      db.query(`
        BEGIN;
        UPDATE public.cafeteria_billing_settings SET billing_model = 'NONE', per_order_fee_cop = NULL;
        SELECT 1 / 0;
        COMMIT;`),
    );
    assert.equal(
      await db.query(
        "SELECT string_agg(setting || ':' || source || ':' || (changed_by IS NOT NULL) || ':' || (new_value ->> 'perOrderFeeCop'), ',' ORDER BY id) FROM public.cafeteria_settings_audit",
      ),
      "BILLING:API:true:1000",
    );
    await assert.rejects(
      db.query("DELETE FROM public.cafeteria_settings_audit;"),
      /cafeteria_settings_audit_immutable|append-only/,
    );
    await assert.rejects(
      db.query("TRUNCATE public.cafeteria_settings_audit;"),
      /append-only/,
    );
    assert.equal(
      await db.query(
        "SELECT bool_or(has_table_privilege(r, t, p)) FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['public.cafeteria_billing_settings','public.cafeteria_settings_audit']) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p",
      ),
      "f",
    );
  },
);
