import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

test("authorization persistence SQL reads current database facts without trusting metadata", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // These are the resources executed by AuthorizationPersistenceAdapter;
  // JDBC uses ?, while PGlite's query API uses $1 for the same bound value.
  const resource = new URL(
    "../../unifood-backend/src/main/resources/sql/authorization/",
    import.meta.url,
  );
  const query = (
    await readFile(new URL("user-authorization.sql", resource), "utf8")
  ).replace("?", "$1");
  const orderQuery = (
    await readFile(new URL("order-cafeteria.sql", resource), "utf8")
  ).replace("?", "$1");
  const site = (
    await db.query(
      "INSERT INTO public.sites(name, city, institution_id) SELECT 'Test site', 'Test city', id FROM public.institutions LIMIT 1 RETURNING id",
    )
  ).rows[0].id;
  const cafeterias = (
    await db.query(
      "INSERT INTO public.cafeterias(site_id, name, lunch_order_start, lunch_order_end) VALUES ($1, 'Assigned', '07:00', '08:00'), ($1, 'Other', '07:00', '08:00') RETURNING id",
      [site],
    )
  ).rows.map(({ id }) => id);
  const orderId = (
    await db.query(
      "INSERT INTO public.orders(cafeteria_id, client_name, total) VALUES ($1, 'Test client', 1) RETURNING id",
      [cafeterias[0]],
    )
  ).rows[0].id;
  const facts = async (userId) => (await db.query(query, [userId])).rows[0];
  let number = 0;
  const createUser = async (roles, active = true) => {
    const userId = (
      await db.query(
        "INSERT INTO auth.users(email, raw_user_meta_data) VALUES ($1, $2) RETURNING id",
        [
          `fixture-${++number}@example.invalid`,
          JSON.stringify({ role: "WORKER", roles: ["SUPER_ADMIN"] }),
        ],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO public.user_roles(user_id, role_id) SELECT $1, id FROM public.roles WHERE name::text = ANY($2::text[])",
      [userId, roles],
    );
    await db.query("UPDATE public.users SET is_active = $2 WHERE id = $1", [
      userId,
      active,
    ]);
    await db.query(
      "INSERT INTO public.cafeteria_users(user_id, cafeteria_id) VALUES ($1, $2)",
      [userId, cafeterias[0]],
    );
    return userId;
  };
  for (const [label, roles, active] of [
    ["assigned active WORKER", ["WORKER"], true],
    ["second WORKER at the same cafeteria", ["WORKER"], true],
    ["ADMIN", ["ADMIN"], true],
    ["SUPER_ADMIN", ["SUPER_ADMIN"], true],
    ["CLIENT", ["CLIENT"], true],
    ["inactive WORKER", ["WORKER"], false],
    ["WORKER plus ADMIN", ["WORKER", "ADMIN"], true],
    ["WORKER plus SUPER_ADMIN", ["WORKER", "SUPER_ADMIN"], true],
    ["all roles", ["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"], true],
    ["no database role despite forged metadata", [], true],
  ]) {
    await t.test(label, async () => {
      const userId = await createUser(roles, active);
      const user = await facts(userId);
      assert.equal(user.is_active, active);
      assert.deepEqual(user.roles.toSorted(), roles.toSorted());
      assert.deepEqual(user.cafeteria_ids, [cafeterias[0]]);
      const orderCafeteria = (await db.query(orderQuery, [orderId])).rows[0]
        .cafeteria_id;
      assert.equal(
        orderCafeteria,
        cafeterias[0],
        "order lookup returns the real cafeteria regardless of the user's roles",
      );
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
        userId,
      ]);
      const current = (
        await db.query("SELECT public.current_auth_profile() AS profile")
      ).rows[0].profile;
      assert.deepEqual(current.roles.toSorted(), roles.toSorted());
      assert.equal(current.active, active);
    });
  }
  await t.test(
    "revoked cafeteria assignment takes effect immediately",
    async () => {
      const userId = await createUser(["WORKER"]);
      assert.deepEqual((await facts(userId)).cafeteria_ids, [cafeterias[0]]);
      await db.query("DELETE FROM public.cafeteria_users WHERE user_id = $1", [
        userId,
      ]);
      assert.deepEqual((await facts(userId)).cafeteria_ids, []);
    },
  );
  await t.test(
    "multiple assignments remain separate facts without role join duplicates",
    async () => {
      const userId = await createUser(["WORKER"]);
      await db.query(
        "INSERT INTO public.cafeteria_users(user_id, cafeteria_id) VALUES ($1, $2)",
        [userId, cafeterias[1]],
      );
      assert.deepEqual(
        (await facts(userId)).cafeteria_ids.toSorted(),
        cafeterias.toSorted(),
      );
      await db.query(
        "DELETE FROM public.cafeteria_users WHERE user_id = $1 AND cafeteria_id = $2",
        [userId, cafeterias[1]],
      );
      assert.deepEqual((await facts(userId)).cafeteria_ids, [cafeterias[0]]);
    },
  );
  await t.test(
    "role revocation and inactivation invalidate a previously resolved context",
    async () => {
      const userId = await createUser(["WORKER"]);
      assert.equal((await facts(userId)).is_active, true);
      await db.query(
        "UPDATE public.users SET is_active = false WHERE id = $1",
        [userId],
      );
      assert.equal((await facts(userId)).is_active, false);
      await db.query("UPDATE public.users SET is_active = true WHERE id = $1", [
        userId,
      ]);
      await db.query("DELETE FROM public.user_roles WHERE user_id = $1", [
        userId,
      ]);
      assert.deepEqual((await facts(userId)).roles, []);
    },
  );
  await t.test("missing users and orders produce no facts", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    assert.equal(await facts(missing), undefined);
    assert.deepEqual((await db.query(orderQuery, [missing])).rows, []);
  });
  await t.test(
    "uq_cafeteria_user rejects a duplicate user/cafeteria pair",
    async () => {
      const userId = await createUser(["WORKER"]);
      await assert.rejects(
        db.query(
          "INSERT INTO public.cafeteria_users(user_id, cafeteria_id) VALUES ($1, $2)",
          [userId, cafeterias[0]],
        ),
        /uq_cafeteria_user/,
      );
      assert.deepEqual((await facts(userId)).cafeteria_ids, [cafeterias[0]]);
    },
  );
  await t.test(
    "three assignments are bounded at two, enough to deny cardinality",
    async () => {
      const userId = await createUser(["WORKER", "CLIENT"]);
      await db.query(
        "INSERT INTO public.cafeteria_users(user_id, cafeteria_id) VALUES ($1, $2)",
        [userId, cafeterias[1]],
      );
      const third = (
        await db.query(
          "INSERT INTO public.cafeterias(site_id, name, lunch_order_start, lunch_order_end) VALUES ($1, 'Third', '07:00', '08:00') RETURNING id",
          [site],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO public.cafeteria_users(user_id, cafeteria_id) VALUES ($1, $2)",
        [userId, third],
      );
      const user = await facts(userId);
      assert.equal(user.cafeteria_ids.length, 2);
      assert.equal(new Set(user.cafeteria_ids).size, 2);
      assert.deepEqual(user.roles.toSorted(), ["CLIENT", "WORKER"]);
    },
  );
});
