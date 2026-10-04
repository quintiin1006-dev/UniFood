import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

test("production OrderAuthorization SQL enforces database roles and cafeteria assignments", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const java = await readFile(
    new URL(
      "../../unifood-backend/src/main/java/com/santotofood/config/OrderAuthorization.java",
      import.meta.url,
    ),
    "utf8",
  );
  let parameter = 0;
  const query = java
    .match(/queryForObject\(\s*"""([\s\S]*?)"""/)?.[1]
    .replace(/\?/g, () => `$${++parameter}`);
  const orderQuery = java
    .match(/queryForList\(\s*"([^"]+)"/)?.[1]
    .replace("?", "$1");
  assert.ok(query);
  assert.ok(orderQuery);
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
  const allowed = async (userId, cafeteriaId) =>
    (await db.query(query, [userId, cafeteriaId])).rows[0].exists;
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
  for (const [label, roles, active, expected] of [
    ["assigned active WORKER", ["WORKER"], true, true],
    ["second WORKER at the same cafeteria", ["WORKER"], true, true],
    ["ADMIN", ["ADMIN"], true, false],
    ["SUPER_ADMIN", ["SUPER_ADMIN"], true, false],
    ["CLIENT", ["CLIENT"], true, false],
    ["inactive WORKER", ["WORKER"], false, false],
    ["WORKER plus ADMIN", ["WORKER", "ADMIN"], true, false],
    ["WORKER plus SUPER_ADMIN", ["WORKER", "SUPER_ADMIN"], true, false],
    ["all roles", ["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"], true, false],
    ["no database role despite forged metadata", [], true, false],
  ]) {
    await t.test(label, async () => {
      const userId = await createUser(roles, active);
      assert.equal(await allowed(userId, cafeterias[0]), expected);
      assert.equal(
        await allowed(userId, cafeterias[1]),
        false,
        "another cafeteria must be denied",
      );
      const orderCafeteria = (await db.query(orderQuery, [orderId])).rows[0]
        .cafeteria_id;
      assert.equal(
        await allowed(userId, orderCafeteria),
        expected,
        "operations use the order's actual cafeteria",
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
      assert.equal(await allowed(userId, cafeterias[0]), true);
      await db.query("DELETE FROM public.cafeteria_users WHERE user_id = $1", [
        userId,
      ]);
      assert.equal(await allowed(userId, cafeterias[0]), false);
    },
  );
});
