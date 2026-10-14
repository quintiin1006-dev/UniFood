import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

const migration = (name) =>
  readFile(
    new URL(
      `../../unifood-backend/supabase/migrations/${name}`,
      import.meta.url,
    ),
    "utf8",
  );
const cardinality = (error) =>
  error.code === "23514" &&
  error.constraint === "cafeteria_profile_cardinality";

async function fixtures(db) {
  const site = (
    await db.query(
      "INSERT INTO public.sites(name,city,institution_id) SELECT 'test','test',id FROM public.institutions LIMIT 1 RETURNING id",
    )
  ).rows[0].id;
  const cafes = (
    await db.query(
      "INSERT INTO public.cafeterias(site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES ($1,'A',false,'07:00','08:00'),($1,'B',false,'07:00','08:00') RETURNING id",
      [site],
    )
  ).rows.map((r) => r.id);
  let number = 0;
  async function user(role) {
    const id = (
      await db.query("INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [
        `fixture-${++number}@example.invalid`,
      ])
    ).rows[0].id;
    await db.query(
      "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name::text=$2",
      [id, role],
    );
    return id;
  }
  const assign = (id, cafe, connection = db) =>
    connection.query(
      "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES ($1,$2)",
      [id, cafe],
    );
  const activate = (id, connection = db) =>
    connection.query("UPDATE public.users SET is_active=true WHERE id=$1", [
      id,
    ]);
  return { cafes, user, assign, activate };
}

test("latest schema enforces complete cafeteria profiles at transaction boundaries", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const f = await fixtures(db);
  await t.test(
    "inactive provisioning, many workers, one admin and cafeteria activation",
    async () => {
      for (let n = 0; n < 3; n++) {
        const worker = await f.user("WORKER");
        await assert.rejects(f.activate(worker), cardinality);
        await f.assign(worker, f.cafes[0]);
        await f.activate(worker);
        await assert.rejects(f.assign(worker, f.cafes[1]), {
          code: "23505",
          constraint: "uq_cafeteria_users_user",
        });
        await assert.rejects(
          db.query("DELETE FROM public.cafeteria_users WHERE user_id=$1", [
            worker,
          ]),
          cardinality,
        );
      }
      await assert.rejects(
        db.query("UPDATE public.cafeterias SET is_active=true WHERE id=$1", [
          f.cafes[0],
        ]),
        cardinality,
      );
      const admin = await f.user("ADMIN");
      await db.transaction(async (tx) => {
        await f.assign(admin, f.cafes[0], tx);
        await f.activate(admin, tx);
        await tx.query(
          "UPDATE public.cafeterias SET is_active=true WHERE id=$1",
          [f.cafes[0]],
        );
      });
      const second = await f.user("ADMIN");
      await assert.rejects(f.assign(second, f.cafes[0]), cardinality);
      await assert.rejects(
        db.query("UPDATE public.users SET is_active=false WHERE id=$1", [
          admin,
        ]),
        cardinality,
      );
      await assert.rejects(
        db.query("DELETE FROM public.cafeteria_users WHERE user_id=$1", [
          admin,
        ]),
        cardinality,
      );
      await assert.rejects(
        db.query(
          "UPDATE public.user_roles SET role_id=(SELECT id FROM public.roles WHERE name='WORKER') WHERE user_id=$1",
          [admin],
        ),
        cardinality,
      );
      // Explicit administrative deactivation permits later removal/replacement.
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE public.cafeterias SET is_active=false WHERE id=$1",
          [f.cafes[0]],
        );
        await tx.query("UPDATE public.users SET is_active=false WHERE id=$1", [
          admin,
        ]);
        await tx.query("DELETE FROM public.cafeteria_users WHERE user_id=$1", [
          admin,
        ]);
      });
    },
  );
  await t.test(
    "CLIENT and SUPER_ADMIN may activate but can never have an assignment",
    async () => {
      for (const role of ["CLIENT", "SUPER_ADMIN"]) {
        const id = await f.user(role);
        await f.activate(id);
        await assert.rejects(f.assign(id, f.cafes[1]), cardinality);
        await db.query("UPDATE public.users SET is_active=false WHERE id=$1", [
          id,
        ]);
        await assert.rejects(f.assign(id, f.cafes[1]), cardinality);
      }
      const pending = (
        await db.query(
          "INSERT INTO auth.users(email) VALUES ('no-role@example.invalid') RETURNING id",
        )
      ).rows[0].id;
      await assert.rejects(f.assign(pending, f.cafes[1]), cardinality);
    },
  );
  await t.test(
    "activation before assignment is allowed only within a valid atomic transaction",
    async () => {
      const id = await f.user("WORKER");
      await db.transaction(async (tx) => {
        await f.activate(id, tx);
        await f.assign(id, f.cafes[1], tx);
      });
      assert.equal(
        (await db.query("SELECT is_active FROM public.users WHERE id=$1", [id]))
          .rows[0].is_active,
        true,
      );
      for (const table of [
        "cafeteria_users",
        "cafeterias",
        "users",
        "user_roles",
        "roles",
      ])
        await assert.rejects(
          db.exec(`TRUNCATE public.${table} CASCADE`),
          cardinality,
        );
    },
  );
});

test("009 pre-audit aborts incompatible legacy profiles and never repairs data", async (t) => {
  for (const scenario of [
    "multiple cafeterias",
    "active worker without cafeteria",
    "client assignment",
    "two admins",
    "active cafe without admin",
  ]) {
    await t.test(scenario, async () => {
      const db = await createAuthDatabase({ throughMigration: "008" });
      try {
        const f = await fixtures(db);
        if (scenario === "active cafe without admin")
          await db.query(
            "UPDATE public.cafeterias SET is_active=true WHERE id=$1",
            [f.cafes[0]],
          );
        else {
          const id = await f.user(
            scenario === "client assignment"
              ? "CLIENT"
              : scenario === "two admins"
                ? "ADMIN"
                : "WORKER",
          );
          if (scenario === "active worker without cafeteria")
            await f.activate(id);
          else {
            await f.assign(id, f.cafes[0]);
            if (scenario === "multiple cafeterias")
              await f.assign(id, f.cafes[1]);
            if (scenario === "two admins")
              await f.assign(await f.user("ADMIN"), f.cafes[0]);
          }
        }
        const before = (
          await db.query(
            "SELECT count(*)::int AS n FROM public.cafeteria_users",
          )
        ).rows[0].n;
        await assert.rejects(
          db.exec(await migration("009_cafeteria_cardinality.sql")),
          cardinality,
        );
        await db.exec("ROLLBACK");
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.cafeteria_users",
            )
          ).rows[0].n,
          before,
        );
        assert.equal(
          (
            await db.query(
              "SELECT to_regclass('public.cafeteria_profile_guard') AS guard",
            )
          ).rows[0].guard,
          null,
        );
      } finally {
        await db.close();
      }
    });
  }
});

test("010 removes platform table/column grants and RLS policies while preserving identity RPCs", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "009" });
  t.after(() => db.close());
  const f = await fixtures(db),
    client = await f.user("CLIENT"),
    worker = await f.user("WORKER");
  await f.activate(client);
  await f.assign(worker, f.cafes[0]);
  await f.activate(worker);
  // Emulate exposed Supabase defaults; prove the migration removes existing grants,
  // including 005's column UPDATE, rather than relying on a fixture with no SELECT grants.
  await db.exec(
    "GRANT USAGE ON SCHEMA public,auth TO anon,authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated; GRANT UPDATE(full_name,phone) ON public.clients TO authenticated;",
  );
  await db.exec(await migration("010_backend_business_authority.sql"));
  for (const [role, id] of [
    ["anon", client],
    ["authenticated", client],
    ["authenticated", worker],
  ]) {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`SET ROLE ${role}`);
    try {
      assert.equal(
        (
          await db.query(
            "SELECT public.is_institutional_email('fixture@ustavillavo.edu.co') AS ok",
          )
        ).rows[0].ok,
        true,
      );
      if (role === "authenticated")
        assert.equal(
          (await db.query("SELECT public.current_auth_profile() AS p")).rows[0]
            .p.active,
          true,
        );
      else
        await assert.rejects(db.query("SELECT public.current_auth_profile()"), {
          code: "42501",
        });
      for (const sql of [
        "SELECT * FROM public.orders",
        "SELECT * FROM public.lunches",
        "SELECT * FROM public.users",
        "UPDATE public.clients SET full_name='forged'",
        "INSERT INTO public.orders(cafeteria_id,client_name,total) VALUES (gen_random_uuid(),'forged',1)",
        "SELECT public.decrease_lunch_stock(gen_random_uuid(),1)",
      ])
        await assert.rejects(db.query(sql), { code: "42501" });
      assert.equal(
        (
          await db.query(
            "SELECT has_column_privilege(current_user,'public.clients','full_name','UPDATE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  await db.query("UPDATE public.users SET is_active=false WHERE id=$1", [
    client,
  ]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    client,
  ]);
  await db.exec("SET ROLE authenticated");
  try {
    assert.equal(
      (await db.query("SELECT public.current_auth_profile() AS p")).rows[0].p
        .active,
      false,
    );
    await assert.rejects(db.query("SELECT * FROM public.orders"), {
      code: "42501",
    });
  } finally {
    await db.exec("RESET ROLE");
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'",
      )
    ).rows[0].n,
    0,
  );
  await db.exec(
    await readFile(
      new URL("../../unifood-backend/supabase/setup_auth.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_column_privilege('authenticated','public.clients','full_name','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  // Managed Auth trigger still creates a valid student through its definer authority.
  await db.query(
    `INSERT INTO auth.users(email,raw_user_meta_data) VALUES ('new@ustavillavo.edu.co','{"registration_type":"student","full_name":"Fixture Student","document":"12345678"}')`,
  );
});

test("read-only preflight detects effective table, column, RPC and helper privileges without repairing them", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const audit = await readFile(
    new URL(
      "../../unifood-backend/supabase/audit_business_integrity.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    audit,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  const rows = (results, column) =>
    results.find((result) =>
      result.fields.some((field) => field.name === column),
    )?.rows;
  const snapshot = async () =>
    (
      await db.query(
        "SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.orders) AS orders,(SELECT count(*) FROM public.order_items) AS items",
      )
    ).rows;
  const before = await snapshot();
  const clean = await db.exec(audit);
  assert.deepEqual(rows(clean, "unexpected_business_table_grant"), []);
  assert.deepEqual(rows(clean, "unexpected_business_column_grant"), []);
  assert.equal(rows(clean, "unexpected_rpc_permission").length, 4);
  assert.ok(
    rows(clean, "unexpected_rpc_permission").every(
      (row) => row.function_exists && !row.unexpected_rpc_permission,
    ),
  );
  assert.ok(
    rows(clean, "unexpected_helper_execute").every(
      (row) => !row.unexpected_helper_execute,
    ),
  );
  assert.deepEqual(await snapshot(), before);

  await db.exec(`
    CREATE ROLE unexpected_reader;
    GRANT DELETE ON public.orders TO unexpected_reader;
    GRANT unexpected_reader TO anon;
    GRANT TRUNCATE ON public.orders TO authenticated;
    GRANT SELECT(lunch_name),INSERT(note) ON public.order_items TO anon;
    GRANT UPDATE(full_name) ON public.clients TO authenticated;
    GRANT EXECUTE ON FUNCTION public.decrease_lunch_stock(uuid,integer) TO PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.is_institutional_email(text) FROM anon;
  `);
  const exposed = await db.exec(audit);
  const table = rows(exposed, "unexpected_business_table_grant");
  assert.ok(
    table.some(
      (row) =>
        row.actor === "anon" &&
        row.unexpected_business_table_grant === "orders" &&
        row.privilege === "DELETE",
    ),
  );
  assert.ok(
    table.some(
      (row) => row.actor === "authenticated" && row.privilege === "TRUNCATE",
    ),
  );
  const columns = rows(exposed, "unexpected_business_column_grant");
  for (const [actor, column, privilege] of [
    ["anon", "lunch_name", "SELECT"],
    ["anon", "note", "INSERT"],
    ["authenticated", "full_name", "UPDATE"],
  ])
    assert.ok(
      columns.some(
        (row) =>
          row.actor === actor &&
          row.column_name === column &&
          row.privilege === privilege,
      ),
    );
  assert.ok(
    rows(exposed, "unexpected_helper_execute").some(
      (row) =>
        row.helper_signature.includes("decrease_lunch_stock") &&
        row.unexpected_helper_execute,
    ),
  );
  assert.ok(
    rows(exposed, "unexpected_rpc_permission").some(
      (row) =>
        row.actor === "anon" &&
        row.signature === "public.is_institutional_email(text)" &&
        row.unexpected_rpc_permission,
    ),
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (
      await db.query(
        "SELECT has_column_privilege('anon','public.order_items','lunch_name','SELECT') AS remains",
      )
    ).rows[0].remains,
    true,
  );
});

test("011 enforces cafeteria relationships and amounts without changing historical snapshots", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const f = await fixtures(db);
  const lunches = [];
  for (const cafe of f.cafes)
    lunches.push(
      (
        await db.query(
          "INSERT INTO public.lunches(cafeteria_id,name,price,category) VALUES ($1,'Original',100,'CORRIENTE') RETURNING id",
          [cafe],
        )
      ).rows[0].id,
    );
  const order = (
    await db.query(
      "INSERT INTO public.orders(cafeteria_id,client_name,total) VALUES ($1,'fixture',200) RETURNING id",
      [f.cafes[0]],
    )
  ).rows[0].id;
  const insert = (lunch, subtotal = 200, orderId = order) =>
    db.query(
      "INSERT INTO public.order_items(order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES ($1,$2,'Original',100,2,$3) RETURNING id",
      [orderId, lunch, subtotal],
    );
  await assert.rejects(insert(lunches[1]), {
    code: "23503",
    constraint: "fk_item_lunch_cafeteria",
  });
  await assert.rejects(insert(lunches[0], 999), {
    code: "23514",
    constraint: "chk_item_subtotal",
  });
  await assert.rejects(insert("00000000-0000-0000-0000-000000000001"), {
    code: "23503",
  });
  await assert.rejects(
    insert(lunches[0], 200, "00000000-0000-0000-0000-000000000001"),
    { code: "23503", constraint: "fk_item_order_cafeteria" },
  );
  const item = (await insert(lunches[0])).rows[0].id;
  await db.query(
    "UPDATE public.lunches SET name='Renamed',price=300 WHERE id=$1",
    [lunches[0]],
  );
  const snapshot = (
    await db.query(
      "SELECT lunch_name,unit_price,subtotal,cafeteria_id FROM public.order_items WHERE id=$1",
      [item],
    )
  ).rows[0];
  assert.deepEqual(snapshot, {
    lunch_name: "Original",
    unit_price: "100.00",
    subtotal: "200.00",
    cafeteria_id: f.cafes[0],
  });
  await assert.rejects(
    db.query("UPDATE public.lunches SET cafeteria_id=$2 WHERE id=$1", [
      lunches[0],
      f.cafes[1],
    ]),
    { code: "23503" },
  );
  await assert.rejects(
    db.query("UPDATE public.orders SET cafeteria_id=$2 WHERE id=$1", [
      order,
      f.cafes[1],
    ]),
    { code: "23503" },
  );
  await assert.rejects(
    db.query("UPDATE public.order_items SET cafeteria_id=$2 WHERE id=$1", [
      item,
      f.cafes[1],
    ]),
    { code: "23503" },
  );
});

test("011 pre-audit rejects inconsistent legacy items without rewriting snapshots", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "010" });
  t.after(() => db.close());
  const f = await fixtures(db);
  const lunch = (
    await db.query(
      "INSERT INTO public.lunches(cafeteria_id,name,price) VALUES ($1,'Original',100) RETURNING id",
      [f.cafes[1]],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "INSERT INTO public.orders(cafeteria_id,client_name,total) VALUES ($1,'fixture',100) RETURNING id",
      [f.cafes[0]],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO public.order_items(order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES ($1,$2,'Original',100,1,999)",
    [order, lunch],
  );
  await assert.rejects(
    db.exec(await migration("011_order_item_integrity.sql")),
    { code: "23514", constraint: "order_item_integrity_audit" },
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (await db.query("SELECT subtotal FROM public.order_items")).rows[0]
      .subtotal,
    "999.00",
  );
});
