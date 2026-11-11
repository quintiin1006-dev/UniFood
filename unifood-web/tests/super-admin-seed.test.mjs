import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase as createFixtureDatabase } from "./helpers/auth-database.mjs";

// The staging SUPER_ADMIN procedure of docs/decisiones.md §3 on the real 001-021 migrations.
const createAuthDatabase = () =>
  createFixtureDatabase({ simulateServerPreauthorization: false });
const script = await readFile(
  new URL("../../scripts/supabase/seed-super-admin.sql", import.meta.url),
  "utf8",
);
const withEmail = (email) => script.replaceAll("'CORREO'", `'${email}'`);

// Steps 2-4: preauthorize, the panel's Auto Confirm user (Admin API simulated), then the script.
async function provision(
  db,
  email,
  { create = true, target = "staging" } = {},
) {
  await db.query("SELECT public.preauthorize_identity($1, 'SUPER_ADMIN')", [
    email,
  ]);
  if (create)
    await db.query(
      "INSERT INTO auth.users(email, email_confirmed_at) VALUES ($1, now())",
      [email],
    );
  if (target) await db.exec(`SET unifood.seed_target = '${target}'`);
  try {
    await db.exec(withEmail(email));
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  } finally {
    await db.exec("RESET unifood.seed_target");
  }
}

const superAdmins = async (db) =>
  (
    await db.query(
      `SELECT u.email, u.is_active, u.email_confirmed_at IS NOT NULL AS confirmed,
              (SELECT count(*)::int FROM public.cafeteria_users cu WHERE cu.user_id = u.id)
                AS cafeterias
       FROM public.users u
       JOIN public.user_roles ur ON ur.user_id = u.id
       JOIN public.roles r ON r.id = ur.role_id
       WHERE r.name = 'SUPER_ADMIN'
       ORDER BY u.email`,
    )
  ).rows;

test("the staging SUPER_ADMIN procedure activates two accounts and rejects a third", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await provision(db, "Uno@Example.com");
  await provision(db, "dos@example.com");
  const two = [
    {
      email: "dos@example.com",
      is_active: true,
      confirmed: true,
      cafeterias: 0,
    },
    {
      email: "uno@example.com",
      is_active: true,
      confirmed: true,
      cafeterias: 0,
    },
  ];
  assert.deepEqual(await superAdmins(db), two);
  await assert.rejects(provision(db, "tres@example.com"), /SUPER_ADMIN_LIMIT/);
  assert.deepEqual(await superAdmins(db), two);
  const third = (
    await db.query(
      `SELECT u.is_active, (SELECT count(*)::int FROM public.user_roles ur WHERE ur.user_id = u.id)
         AS roles
       FROM public.users u WHERE u.email = 'tres@example.com'`,
    )
  ).rows;
  assert.deepEqual(third, [{ is_active: false, roles: 0 }]);
});

test("the procedure refuses outside staging, without the identity or with the bare marker", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await assert.rejects(
    provision(db, "uno@example.com", { target: null }),
    /unifood-staging only/,
  );
  await assert.rejects(
    provision(db, "nadie@example.com", { create: false }),
    /SUPER_ADMIN_IDENTITY_MISSING/,
  );
  await db.exec("SET unifood.seed_target = 'staging'");
  await assert.rejects(db.exec(script), /SUPER_ADMIN_IDENTITY_MISSING/);
  await db.exec("ROLLBACK");
  assert.deepEqual(await superAdmins(db), []);
  // The first rejection left the identity inactive and without a role; it can still be finished.
  await provision(db, "uno@example.com", { create: false });
  assert.equal((await superAdmins(db)).length, 1);
});
