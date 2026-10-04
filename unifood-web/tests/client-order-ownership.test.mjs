import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

test("client ownership SQL follows actual PostgreSQL links and current roles, never metadata", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const resources = new URL(
    "../../unifood-backend/src/main/resources/sql/authorization/",
    import.meta.url,
  );
  const ownerSql = (
    await readFile(new URL("order-owner.sql", resources), "utf8")
  ).replace("?", "$1");
  const userSql = (
    await readFile(new URL("user-authorization.sql", resources), "utf8")
  ).replace("?", "$1");
  const institution = (
    await db.query("SELECT id FROM public.institutions LIMIT 1")
  ).rows[0].id;
  const site = (
    await db.query(
      "INSERT INTO public.sites(name,city,institution_id) VALUES ('Fixture','Fixture',$1) RETURNING id",
      [institution],
    )
  ).rows[0].id;
  const cafeteria = (
    await db.query(
      "INSERT INTO public.cafeterias(site_id,name,lunch_order_start,lunch_order_end) VALUES ($1,'Fixture','07:00','08:00') RETURNING id",
      [site],
    )
  ).rows[0].id;
  async function createClient(number) {
    const user = (
      await db.query(
        "INSERT INTO auth.users(email,raw_user_meta_data) VALUES ($1,$2) RETURNING id",
        [
          `client-${number}@example.invalid`,
          JSON.stringify({
            role: "SUPER_ADMIN",
            roles: ["WORKER"],
            userId: "forged",
          }),
        ],
      )
    ).rows[0].id;
    const client = (
      await db.query(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id) VALUES ($1,'Fixture',$2,$3) RETURNING id",
        [user, `fixture-${number}`, institution],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name='CLIENT'",
      [user],
    );
    await db.query("UPDATE public.users SET is_active=true WHERE id=$1", [
      user,
    ]);
    return { user, client };
  }
  const first = await createClient(1),
    second = await createClient(2);
  async function createOrder(client) {
    return (
      await db.query(
        "INSERT INTO public.orders(cafeteria_id,client_id,client_name,client_document,total,cancellation_deadline) VALUES ($1,$2,'Other snapshot','untrusted',1,'2020-01-01') RETURNING id",
        [cafeteria, client],
      )
    ).rows[0].id;
  }
  const own = await createOrder(first.client),
    foreign = await createOrder(second.client),
    unlinked = await createOrder(null);
  const owner = async (id) => (await db.query(ownerSql, [id])).rows;
  const facts = async () => (await db.query(userSql, [first.user])).rows[0];

  await t.test(
    "owner is the linked user UUID rather than client UUID or order snapshots",
    async () => {
      assert.notEqual(first.user, first.client);
      assert.deepEqual(await owner(own), [{ user_id: first.user }]);
      assert.deepEqual(await owner(foreign), [{ user_id: second.user }]);
      assert.deepEqual(await owner(unlinked), [{ user_id: null }]);
      assert.deepEqual(await owner("00000000-0000-0000-0000-000000000000"), []);
      assert.deepEqual((await facts()).roles, ["CLIENT"]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        first.user,
      ]);
      const profile = (
        await db.query("SELECT public.current_auth_profile() AS profile")
      ).rows[0].profile;
      assert.deepEqual(profile.roles, ["CLIENT"]);
    },
  );
  await t.test(
    "forged metadata and request subject do not replace ownership or database roles",
    async () => {
      await db.query(
        "UPDATE auth.users SET raw_user_meta_data=$2 WHERE id=$1",
        [
          first.user,
          JSON.stringify({
            role: "CLIENT",
            clientId: second.client,
            userId: second.user,
          }),
        ],
      );
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        second.user,
      ]);
      assert.deepEqual(await owner(own), [{ user_id: first.user }]);
      assert.deepEqual((await facts()).roles, ["CLIENT"]);
    },
  );
  await t.test(
    "inactivation and role changes are visible on the very next read",
    async () => {
      await db.query("UPDATE public.users SET is_active=false WHERE id=$1", [
        first.user,
      ]);
      assert.equal((await facts()).is_active, false);
      await db.query("DELETE FROM public.user_roles WHERE user_id=$1", [
        first.user,
      ]);
      assert.deepEqual((await facts()).roles, []);
      await db.query(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name='ADMIN'",
        [first.user],
      );
      assert.deepEqual((await facts()).roles, ["ADMIN"]);
      await db.query("UPDATE public.users SET is_active=true WHERE id=$1", [
        first.user,
      ]);
      assert.equal((await facts()).is_active, true);
    },
  );
  await t.test(
    "unlinking or reassigning a client changes the actual ownership immediately",
    async () => {
      await db.query("UPDATE public.orders SET client_id=$2 WHERE id=$1", [
        own,
        second.client,
      ]);
      assert.deepEqual(await owner(own), [{ user_id: second.user }]);
      await db.query("UPDATE public.orders SET client_id=NULL WHERE id=$1", [
        own,
      ]);
      assert.deepEqual(await owner(own), [{ user_id: null }]);
    },
  );
});
