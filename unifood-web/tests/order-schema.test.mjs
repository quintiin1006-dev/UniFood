import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createAuthDatabase as createFixtureDatabase } from "./helpers/auth-database.mjs";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

// Migrations 019-021: the base of the order backend. Real migrations, no fixture trigger.
const createAuthDatabase = (options = {}) =>
  createFixtureDatabase({ ...options, simulateServerPreauthorization: false });
const migrations = new URL(
  "../../unifood-backend/supabase/migrations/",
  import.meta.url,
);
const migration = (name) => readFile(new URL(name, migrations), "utf8");
const scripts = new URL("../../scripts/supabase/", import.meta.url);
const ACTIVE = ["PENDING", "PREPARING", "READY", "CALLED"];
const TERMINAL = ["DELIVERED", "NOT_COLLECTED", "CANCELLED"];
const KEY = "k".repeat(16);
const HASH = "a".repeat(64);

const one = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];
const unique = (name) => (error) =>
  error.code === "23505" && error.message.includes(name);
const check = (name) => (error) =>
  error.code === "23514" &&
  (error.constraint === name || error.message.includes(name));

// A cafeteria and active CLIENT accounts, as the server would provision them.
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
  const cafeteria = (
    await one(
      db,
      `INSERT INTO public.cafeterias (site_id, name, is_active, lunch_order_start, lunch_order_end)
       VALUES ($1, 'Cafetería de prueba', false, '06:00', '18:00') RETURNING id`,
      [site],
    )
  ).id;
  let sequence = 0;
  async function client() {
    const email = `cliente${++sequence}@example.invalid`;
    await db.query("SELECT public.preauthorize_identity($1, 'WORKER')", [
      email,
    ]);
    const user = (
      await one(db, "INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [
        email,
      ])
    ).id;
    await db.exec("BEGIN");
    const id = (
      await one(
        db,
        `INSERT INTO public.clients (user_id, full_name, institution_id, client_type, institutional_code)
         VALUES ($1, 'Cliente de prueba', $2, 'STUDENT', $3) RETURNING id`,
        [user, institution, String(7000000 + sequence)],
      )
    ).id;
    await db.query(
      "INSERT INTO public.user_roles (user_id, role_id) SELECT $1, id FROM public.roles WHERE name = 'CLIENT'",
      [user],
    );
    await db.query("UPDATE public.users SET is_active = true WHERE id = $1", [
      user,
    ]);
    await db.exec("COMMIT");
    return { id, user };
  }
  const order = (clientId, status = "PENDING", extra = {}) => {
    const columns = {
      cafeteria_id: cafeteria,
      client_id: clientId,
      client_name: "Cliente de prueba",
      total: 13000,
      status,
      ...(status === "CANCELLED" ? { cancelled_at: new Date() } : {}),
      ...extra,
    };
    const names = Object.keys(columns);
    return db.query(
      `INSERT INTO public.orders (${names.join(", ")})
       VALUES (${names.map((name, i) => `$${i + 1}${name === "status" ? "::public.order_status" : ""}`).join(", ")})
       RETURNING id`,
      Object.values(columns),
    );
  };
  return { institution, site, cafeteria, client, order };
}

test("019 adds BEBIDA and running it again changes nothing", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await db.exec(await migration("019_catalog_category_bebida.sql"));
  assert.deepEqual(
    (
      await db.query(
        "SELECT unnest(enum_range(NULL::public.catalog_category))::text AS v",
      )
    ).rows.map((row) => row.v),
    ["DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO", "BEBIDA"],
  );
  const { cafeteria } = await world(db);
  await db.query(
    `INSERT INTO public.lunches (cafeteria_id, name, price, category)
     VALUES ($1, 'Jugo natural', 4500, 'BEBIDA')`,
    [cafeteria],
  );
});

test("020 allows one active order per client; terminal ones do not count", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { client, order } = await world(db);
  for (const active of ACTIVE) {
    const ana = await client();
    await order(ana.id, active);
    for (const second of ACTIVE)
      await assert.rejects(
        order(ana.id, second),
        unique("uq_orders_one_active_per_client"),
        `${active} then ${second}`,
      );
  }
  const eva = await client();
  for (const terminal of TERMINAL) await order(eva.id, terminal);
  await order(eva.id, "PENDING");
  // Orders without a client are history, never compared.
  for (let i = 0; i < 3; i++) await order(null, "PENDING");
  // Moving an order back to active is caught too.
  const ivan = await client();
  const old = (await order(ivan.id, "DELIVERED")).rows[0].id;
  await order(ivan.id, "PENDING");
  await assert.rejects(
    db.query("UPDATE public.orders SET status = 'PREPARING' WHERE id = $1", [
      old,
    ]),
    unique("uq_orders_one_active_per_client"),
  );
});

test("020 idempotency keys are unique per client, for good, and come with a hash", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { client, order } = await world(db);
  const ana = await client();
  const eva = await client();
  await order(ana.id, "DELIVERED", {
    idempotency_key: KEY,
    request_hash: HASH,
  });
  // Even after delivery, repeating the key is a retry, never a new order.
  await assert.rejects(
    order(ana.id, "PENDING", { idempotency_key: KEY, request_hash: HASH }),
    unique("uq_orders_client_idempotency_key"),
  );
  await order(eva.id, "PENDING", { idempotency_key: KEY, request_hash: HASH });
  for (const [extra, constraint] of [
    [{ idempotency_key: KEY }, "chk_orders_idempotency_pair"],
    [{ request_hash: HASH }, "chk_orders_idempotency_pair"],
    [
      { idempotency_key: "short", request_hash: HASH },
      "chk_orders_idempotency_key_format",
    ],
    [
      { idempotency_key: `${KEY} x`, request_hash: HASH },
      "chk_orders_idempotency_key_format",
    ],
    [
      { idempotency_key: KEY + "2", request_hash: "A".repeat(64) },
      "chk_orders_request_hash_format",
    ],
  ])
    await assert.rejects(
      order(ana.id, "PENDING", extra),
      check(constraint),
      JSON.stringify(extra),
    );
});

test("021 records who ended an order, keeps the 008 flag in step and makes it immutable", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { client, order } = await world(db);
  const source = async (id) =>
    one(
      db,
      "SELECT cancellation_source, cancelled_by_client FROM public.orders WHERE id = $1",
      [id],
    );
  const cancel = (id, set = "") =>
    db.query(
      `UPDATE public.orders SET status = 'CANCELLED', cancelled_at = now()${set} WHERE id = $1`,
      [id],
    );

  // Today's Spring: only the 008 flag.
  const byClient = (await order((await client()).id)).rows[0].id;
  await cancel(byClient, ", cancelled_by_client = true");
  assert.deepEqual(await source(byClient), {
    cancellation_source: "CLIENT",
    cancelled_by_client: true,
  });
  const byWorker = (await order((await client()).id)).rows[0].id;
  await cancel(byWorker);
  assert.deepEqual(await source(byWorker), {
    cancellation_source: "WORKER",
    cancelled_by_client: false,
  });
  // A future writer that sets the source gets the flag for free.
  const bySystem = (await order((await client()).id)).rows[0].id;
  await cancel(bySystem, ", cancellation_source = 'SYSTEM'");
  assert.deepEqual(await source(bySystem), {
    cancellation_source: "SYSTEM",
    cancelled_by_client: false,
  });
  // Only cancelled orders have a source, and it cannot be rewritten.
  await assert.rejects(
    order((await client()).id, "PENDING", { cancellation_source: "CLIENT" }),
    check("chk_orders_cancellation_source_state"),
  );
  await assert.rejects(
    db.query(
      "UPDATE public.orders SET cancellation_source = 'CLIENT' WHERE id = $1",
      [byWorker],
    ),
    check("orders_cancellation_immutable"),
  );
  await assert.rejects(
    cancel(
      (await order((await client()).id)).rows[0].id,
      ", cancellation_source = 'OTHER'",
    ),
    check("chk_orders_cancellation_source"),
  );
});

test("021 rejection needs a worker source, a reason, its author, and stays fixed", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { client, order } = await world(db);
  const worker = (await client()).user;
  const reject = (id, reason, by = worker) =>
    db.query(
      `UPDATE public.orders SET status = 'CANCELLED', cancelled_at = now(),
         cancellation_source = 'WORKER', rejection_reason = $2, rejected_by = $3
       WHERE id = $1`,
      [id, reason, by],
    );
  for (const [reason, by] of [
    ["Sin ingredientes", null],
    [null, worker],
    ["No", worker],
    [" Sin ingredientes", worker],
    ["x".repeat(301), worker],
  ]) {
    const id = (await order((await client()).id)).rows[0].id;
    await assert.rejects(
      reject(id, reason, by),
      check("chk_orders_rejection"),
      String(reason),
    );
  }
  const id = (await order((await client()).id)).rows[0].id;
  await reject(id, "Sin ingredientes para el plato");
  await assert.rejects(
    db.query(
      "UPDATE public.orders SET rejection_reason = 'Otro motivo' WHERE id = $1",
      [id],
    ),
    check("orders_cancellation_immutable"),
  );
  // A client cannot appear as the one who rejected.
  const other = (await order((await client()).id)).rows[0].id;
  await assert.rejects(
    db.query(
      `UPDATE public.orders SET status = 'CANCELLED', cancelled_at = now(),
         cancellation_source = 'CLIENT', rejection_reason = 'Sin ingredientes', rejected_by = $2
       WHERE id = $1`,
      [other, worker],
    ),
    check("chk_orders_rejection"),
  );
});

test("021 keeps one trimmed note of up to 200 characters and a numeric client code", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { client, order } = await world(db);
  for (const note of ["", " Sin cebolla", "x".repeat(201)])
    await assert.rejects(
      order((await client()).id, "PENDING", { note }),
      check("chk_orders_note"),
      JSON.stringify(note),
    );
  await order((await client()).id, "PENDING", {
    note: "x".repeat(200),
    client_code: "0012345",
    client_type: "STUDENT",
  });
  await assert.rejects(
    order((await client()).id, "PENDING", { client_code: "12a4567" }),
    check("chk_orders_client_code_digits"),
  );
});

test("upgrading from 018 keeps existing orders and derives only who cancelled", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "018" });
  t.after(() => db.close());
  const { client, order } = await world(db);
  const ana = await client();
  const legacy = {
    pending: (await order(ana.id, "PENDING")).rows[0].id,
    byClient: (await order(ana.id, "CANCELLED", { cancelled_by_client: true }))
      .rows[0].id,
    byWorker: (await order(ana.id, "CANCELLED")).rows[0].id,
    delivered: (await order(null, "DELIVERED")).rows[0].id,
  };
  for (const name of [
    "019_catalog_category_bebida.sql",
    "020_order_idempotency.sql",
    "021_order_rejection_and_snapshots.sql",
  ])
    await db.exec(await migration(name));
  const row = (id) =>
    one(
      db,
      `SELECT status, cancellation_source, cancelled_by_client, client_code, client_type,
              note, idempotency_key
       FROM public.orders WHERE id = $1`,
      [id],
    );
  const base = {
    client_code: null,
    client_type: null,
    note: null,
    idempotency_key: null,
  };
  assert.deepEqual(await row(legacy.pending), {
    ...base,
    status: "PENDING",
    cancellation_source: null,
    cancelled_by_client: false,
  });
  assert.deepEqual(await row(legacy.byClient), {
    ...base,
    status: "CANCELLED",
    cancellation_source: "CLIENT",
    cancelled_by_client: true,
  });
  assert.deepEqual(await row(legacy.byWorker), {
    ...base,
    status: "CANCELLED",
    cancellation_source: "WORKER",
    cancelled_by_client: false,
  });
  assert.equal((await row(legacy.delivered)).status, "DELIVERED");
  // Running 020 and 021 again is harmless.
  await db.exec(await migration("020_order_idempotency.sql"));
  await db.exec(await migration("021_order_rejection_and_snapshots.sql"));
  assert.equal((await row(legacy.byClient)).cancellation_source, "CLIENT");
});

test("020 refuses to run while a client has two active orders, and changes nothing", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "019" });
  t.after(() => db.close());
  const { client, order } = await world(db);
  const ana = await client();
  await order(ana.id, "PENDING");
  await order(ana.id, "READY");
  await assert.rejects(
    db.exec(await migration("020_order_idempotency.sql")),
    /at most one active order per client/,
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (
      await one(
        db,
        "SELECT to_regclass('public.uq_orders_one_active_per_client') AS i",
      )
    ).i,
    null,
  );
});

test("orders stay closed to browser roles, new columns included, even with Supabase defaults", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "000" });
  t.after(() => db.close());
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
  for (const name of (await readdir(migrations))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(await migration(name));
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await one(
            db,
            "SELECT has_table_privilege($1, 'public.orders', $2) AS ok",
            [role, privilege],
          )
        ).ok,
        false,
        `${role} ${privilege}`,
      );
    for (const column of [
      "idempotency_key",
      "request_hash",
      "note",
      "cancellation_source",
      "rejection_reason",
      "rejected_by",
      "client_code",
      "client_type",
    ])
      for (const privilege of ["SELECT", "UPDATE"])
        assert.equal(
          (
            await one(
              db,
              "SELECT has_column_privilege($1, 'public.orders', $2, $3) AS ok",
              [role, column, privilege],
            )
          ).ok,
          false,
          `${role} ${privilege} ${column}`,
        );
    assert.equal(
      (
        await one(
          db,
          "SELECT has_function_privilege($1, 'public.sync_order_cancellation_source()', 'EXECUTE') AS ok",
          [role],
        )
      ).ok,
      false,
    );
  }
});

test("staging-check.sql reports the 019-021 objects", async (t) => {
  const script = await readFile(new URL("staging-check.sql", scripts), "utf8");
  const run = async (db) => (await db.exec(script)).at(-1).rows;
  const before = await createAuthDatabase({ throughMigration: "018" });
  t.after(() => before.close());
  const missing = (await run(before))
    .filter((row) => !row.ok)
    .map((row) => row.object);
  assert.ok(missing.length >= 6, missing.join(", "));
  const after = await createAuthDatabase();
  t.after(() => after.close());
  const { client, order } = await world(after);
  await order((await client()).id, "CANCELLED");
  assert.deepEqual(
    (await run(after)).filter((row) => !row.ok),
    [],
  );
});

test("seed-demo.sql refuses without the staging marker, then seeds once and keeps choices", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const seed = await readFile(new URL("seed-demo.sql", scripts), "utf8");
  await assert.rejects(db.exec(seed), /unifood-staging only/);
  await db.exec("ROLLBACK");
  await db.exec("SET unifood.seed_target = 'staging'");
  await db.exec(seed);
  const products = async () =>
    (
      await db.query(
        `SELECT l.name, l.price::int AS price, l.category::text AS category
         FROM public.lunches l JOIN public.cafeterias c ON c.id = l.cafeteria_id
         WHERE c.name = 'Cafetería Central' ORDER BY l.category, l.price`,
      )
    ).rows;
  assert.deepEqual(await products(), [
    { name: "Corriente del día", price: 13000, category: "CORRIENTE" },
    { name: "Corriente con pechuga", price: 14500, category: "CORRIENTE" },
    { name: "Ejecutivo de res", price: 19000, category: "EJECUTIVO" },
    { name: "Ejecutivo de pescado", price: 21000, category: "EJECUTIVO" },
    { name: "Arepa con queso y chocolate", price: 7000, category: "DESAYUNO" },
    { name: "Calentado con huevo", price: 9500, category: "DESAYUNO" },
    { name: "Gaseosa 400 ml", price: 3500, category: "BEBIDA" },
    { name: "Jugo natural", price: 4500, category: "BEBIDA" },
  ]);
  const state = async () =>
    one(
      db,
      `SELECT c.is_active,
         (SELECT is_open FROM public.cafeteria_daily_states s
          WHERE s.cafeteria_id = c.id
            AND s.business_date = (now() AT TIME ZONE 'America/Bogota')::date) AS open_today,
         (SELECT count(*)::int FROM public.daily_item_availability d
          WHERE d.cafeteria_id = c.id AND d.is_available
            AND d.business_date = (now() AT TIME ZONE 'America/Bogota')::date) AS available_today
       FROM public.cafeterias c WHERE c.name = 'Cafetería Central'`,
    );
  // Inactive until its ADMIN exists (009); open and stocked for today.
  assert.deepEqual(await state(), {
    is_active: false,
    open_today: true,
    available_today: 8,
  });
  // A second run keeps what the worker chose for today.
  await db.query(
    `UPDATE public.cafeteria_daily_states SET is_open = false
     WHERE cafeteria_id = (SELECT id FROM public.cafeterias WHERE name = 'Cafetería Central')`,
  );
  await db.exec(seed);
  assert.equal((await products()).length, 8);
  assert.equal((await state()).open_today, false);
});

test("the demo ADMIN and WORKER guide activates the seeded cafeteria", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await db.exec("SET unifood.seed_target = 'staging'");
  await db.exec(await readFile(new URL("seed-demo.sql", scripts), "utf8"));
  // Same SQL as docs/decisiones.md, with the panel's Admin API user creation simulated.
  const provision = async (email, role, activateCafeteria) => {
    await db.query("SELECT public.preauthorize_identity($1, $2)", [
      email,
      role,
    ]);
    await db.query(
      "INSERT INTO auth.users(email, email_confirmed_at) VALUES ($1, now())",
      [email],
    );
    await db.exec("BEGIN");
    await db.query(
      `INSERT INTO public.user_roles (user_id, role_id)
       SELECT u.id, r.id FROM public.users u, public.roles r
       WHERE u.email = lower($1) AND r.name = $2`,
      [email, role],
    );
    await db.query(
      `INSERT INTO public.cafeteria_users (cafeteria_id, user_id)
       SELECT c.id, u.id
       FROM public.cafeterias c
       JOIN public.sites s ON s.id = c.site_id
       CROSS JOIN public.users u
       WHERE s.name = 'Sede Principal' AND c.name = 'Cafetería Central'
         AND u.email = lower($1)`,
      [email],
    );
    await db.query(
      "UPDATE public.users SET is_active = true WHERE email = lower($1)",
      [email],
    );
    if (activateCafeteria)
      await db.query(
        `UPDATE public.cafeterias SET is_active = true
         WHERE name = 'Cafetería Central'
           AND site_id = (SELECT id FROM public.sites WHERE name = 'Sede Principal')`,
      );
    await db.exec("COMMIT");
  };
  await provision("demo+admin@example.com", "ADMIN", true);
  await provision("demo+worker@example.com", "WORKER", false);
  assert.deepEqual(
    (
      await db.query(
        `SELECT u.email, r.name AS role, u.is_active, c.is_active AS cafeteria_active
         FROM public.users u
         JOIN public.user_roles ur ON ur.user_id = u.id
         JOIN public.roles r ON r.id = ur.role_id
         JOIN public.cafeteria_users cu ON cu.user_id = u.id
         JOIN public.cafeterias c ON c.id = cu.cafeteria_id
         ORDER BY r.name::text`,
      )
    ).rows,
    [
      {
        email: "demo+admin@example.com",
        role: "ADMIN",
        is_active: true,
        cafeteria_active: true,
      },
      {
        email: "demo+worker@example.com",
        role: "WORKER",
        is_active: true,
        cafeteria_active: true,
      },
    ],
  );
});

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail("Timed out waiting for PostgreSQL lock evidence");
}

test(
  "native PostgreSQL lets only one of two concurrent active orders for a client commit",
  { timeout: 120000 },
  async (t) => {
    const binaries = await postgresBinaries();
    if (!binaries) return t.skip("Native PostgreSQL is not installed");
    const db = await createNativeAuthDatabase(binaries, {
      simulateServerPreauthorization: false,
    });
    t.after(() => db.close());
    const [cafeteria, client] = (
      await db.query(`
        SELECT public.preauthorize_identity('concurrente@example.invalid', 'WORKER');
        INSERT INTO auth.users(email) VALUES ('concurrente@example.invalid');
        INSERT INTO public.sites (name, city, institution_id)
          SELECT 'Sede', 'Villavicencio', id FROM public.institutions
          WHERE email_domain = 'ustavillavo.edu.co';
        INSERT INTO public.cafeterias (site_id, name, is_active, lunch_order_start, lunch_order_end)
          SELECT id, 'Cafetería', false, '06:00', '18:00' FROM public.sites;
        BEGIN;
        INSERT INTO public.clients (user_id, full_name, institution_id, client_type, institutional_code)
          SELECT u.id, 'Cliente', i.id, 'STUDENT', '7000001'
          FROM public.users u, public.institutions i WHERE i.email_domain = 'ustavillavo.edu.co';
        INSERT INTO public.user_roles (user_id, role_id)
          SELECT u.id, r.id FROM public.users u, public.roles r WHERE r.name = 'CLIENT';
        UPDATE public.users SET is_active = true;
        COMMIT;
        SELECT (SELECT id FROM public.cafeterias) || ' ' || (SELECT id FROM public.clients);`)
    )
      .split(/\r?\n/)
      .at(-1)
      .split(" ");
    const insert = (key) => `
      INSERT INTO public.orders (cafeteria_id, client_id, client_name, total, idempotency_key, request_hash)
      VALUES ('${cafeteria}', '${client}', 'Cliente', 13000, '${key}', '${HASH}');`;

    const first = db.session();
    const second = db.session();
    first.write(`BEGIN; ${insert("a".repeat(16))}`);
    await until(async () =>
      (
        await db.query(
          "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'",
        )
      ).startsWith("1"),
    );
    second.write(insert("b".repeat(16)));
    await until(async () =>
      (
        await db.query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
        )
      ).startsWith("1"),
    );
    first.write("COMMIT;");
    first.end();
    second.end();
    const [winner, loser] = await Promise.all([first.done, second.done]);
    assert.equal(winner.code, 0);
    assert.notEqual(loser.code, 0);
    assert.match(loser.errors, /uq_orders_one_active_per_client/);
    assert.equal(await db.query("SELECT count(*) FROM public.orders"), "1");
  },
);
