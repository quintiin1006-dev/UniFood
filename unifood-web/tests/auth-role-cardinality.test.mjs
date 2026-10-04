import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

const migrationUrl = new URL(
  "../../unifood-backend/supabase/migrations/007_auth_role_cardinality.sql",
  import.meta.url,
);
const setupUrl = new URL(
  "../../unifood-backend/supabase/setup_auth.sql",
  import.meta.url,
);
const invariantError = (error) =>
  error.code === "23514" &&
  error.constraint === "active_user_single_business_role";

test("role cardinality is enforced by the real schema at transaction boundaries", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  let sequence = 0;
  async function pending() {
    return (
      await db.query("INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [
        `pending-${++sequence}@example.invalid`,
      ])
    ).rows[0].id;
  }
  const assign = (user, role = "WORKER", connection = db) =>
    connection.query(
      "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name::text=$2",
      [user, role],
    );
  const activate = (user, connection = db) =>
    connection.query("UPDATE public.users SET is_active=true WHERE id=$1", [
      user,
    ]);
  const remove = (user, connection = db) =>
    connection.query("DELETE FROM public.user_roles WHERE user_id=$1", [user]);
  const facts = async (user) =>
    (
      await db.query(
        "SELECT is_active,(SELECT count(*)::integer FROM public.user_roles WHERE user_id=u.id) AS roles FROM public.users u WHERE id=$1",
        [user],
      )
    ).rows[0];

  await t.test(
    "non-student identities start inactive and ignore privileged metadata",
    async () => {
      const user = (
        await db.query(
          'INSERT INTO auth.users(email,raw_user_meta_data) VALUES (\'metadata@example.invalid\',\'{"role":"ADMIN","roles":["SUPER_ADMIN"]}\') RETURNING id',
        )
      ).rows[0].id;
      assert.deepEqual(await facts(user), { is_active: false, roles: 0 });
    },
  );
  await t.test(
    "each known role permits activation and different users may share it",
    async () => {
      for (const role of [
        "CLIENT",
        "WORKER",
        "ADMIN",
        "SUPER_ADMIN",
        "WORKER",
      ]) {
        const user = await pending();
        await assign(user, role);
        await activate(user);
        assert.deepEqual(await facts(user), { is_active: true, roles: 1 });
      }
    },
  );
  await t.test(
    "activation without a role fails at COMMIT and rolls back",
    async () => {
      const user = await pending();
      await assert.rejects(
        db.transaction(async (tx) => {
          await activate(user, tx);
          assert.equal(
            (
              await tx.query("SELECT is_active FROM public.users WHERE id=$1", [
                user,
              ])
            ).rows[0].is_active,
            true,
          );
        }),
        invariantError,
      );
      assert.deepEqual(await facts(user), { is_active: false, roles: 0 });
    },
  );
  await t.test(
    "activation before role insertion succeeds within one transaction",
    async () => {
      const user = await pending();
      await db.transaction(async (tx) => {
        await activate(user, tx);
        await assign(user, "ADMIN", tx);
      });
      assert.deepEqual(await facts(user), { is_active: true, roles: 1 });
    },
  );
  await t.test(
    "last-role deletion fails, but atomic replacement and deactivation succeed",
    async () => {
      const user = await pending();
      await assign(user);
      await activate(user);
      await assert.rejects(remove(user), invariantError);
      assert.deepEqual(await facts(user), { is_active: true, roles: 1 });
      await db.transaction(async (tx) => {
        await remove(user, tx);
        await assign(user, "ADMIN", tx);
      });
      await db.transaction(async (tx) => {
        await remove(user, tx);
        await tx.query("UPDATE public.users SET is_active=false WHERE id=$1", [
          user,
        ]);
      });
      assert.deepEqual(await facts(user), { is_active: false, roles: 0 });
    },
  );
  await t.test(
    "UNIQUE(user_id) rejects INSERT and assignment moves onto another assigned user",
    async () => {
      const first = await pending(),
        second = await pending();
      await assign(first, "WORKER");
      await assign(second, "CLIENT");
      await assert.rejects(assign(first, "ADMIN"), {
        code: "23505",
        constraint: "uq_user_roles_user",
      });
      await assert.rejects(
        db.query("UPDATE public.user_roles SET user_id=$2 WHERE user_id=$1", [
          first,
          second,
        ]),
        { code: "23505", constraint: "uq_user_roles_user" },
      );
    },
  );
  await t.test(
    "assignment moves validate both the old and new users",
    async () => {
      const first = await pending(),
        second = await pending();
      await assign(first);
      await activate(first);
      await assert.rejects(
        db.query("UPDATE public.user_roles SET user_id=$2 WHERE user_id=$1", [
          first,
          second,
        ]),
        invariantError,
      );
      assert.deepEqual(await facts(first), { is_active: true, roles: 1 });
      assert.deepEqual(await facts(second), { is_active: false, roles: 0 });
      await db.transaction(async (tx) => {
        await tx.query("UPDATE public.users SET is_active=false WHERE id=$1", [
          first,
        ]);
        await tx.query(
          "UPDATE public.user_roles SET user_id=$2 WHERE user_id=$1",
          [first, second],
        );
        await activate(second, tx);
      });
      assert.deepEqual(await facts(second), { is_active: true, roles: 1 });
    },
  );
  await t.test(
    "unknown roles are rejected by enum/FK and cascading user deletion remains valid",
    async () => {
      const user = await pending();
      await assert.rejects(
        db.query("INSERT INTO public.roles(name) VALUES ('UNKNOWN')"),
        { code: "22P02" },
      );
      await assert.rejects(
        db.query(
          "INSERT INTO public.user_roles(user_id,role_id) VALUES ($1,'00000000-0000-0000-0000-000000000000')",
          [user],
        ),
        { code: "23503" },
      );
      await assign(user);
      await activate(user);
      await db.query("DELETE FROM auth.users WHERE id=$1", [user]);
      assert.equal(await facts(user), undefined);
    },
  );
  await t.test(
    "TRUNCATE cannot bypass the deferred row invariant",
    async () => {
      await assert.rejects(
        db.exec("TRUNCATE public.user_roles"),
        invariantError,
      );
    },
  );
  await t.test(
    "full UUID lock keys differ even for users sharing the same prefix",
    async () => {
      const rows = (
        await db.query(
          "SELECT public.auth_role_lock_key(('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid)::text AS key FROM generate_series(1,128) n",
        )
      ).rows;
      assert.equal(new Set(rows.map(({ key }) => key)).size, 128);
      const triggers = (
        await db.query(
          "SELECT tgname,tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgname IN ('trg_users_auth_role_cardinality','trg_user_roles_auth_role_cardinality')",
        )
      ).rows;
      assert.equal(triggers.length, 2);
      assert.ok(
        triggers.every(
          (trigger) => trigger.tgdeferrable && trigger.tginitdeferred,
        ),
      );
    },
  );
  await t.test(
    "setup_auth is repeatable after 007 and preserves inactive provisioning",
    async () => {
      const setup = await readFile(setupUrl, "utf8");
      await db.exec(setup);
      await db.exec(setup);
      const user = await pending();
      assert.deepEqual(await facts(user), { is_active: false, roles: 0 });
      await assert.rejects(activate(user), invariantError);
      await assign(user);
      await assert.rejects(assign(user, "ADMIN"), {
        code: "23505",
        constraint: "uq_user_roles_user",
      });
    },
  );
});

test("007 refuses incompatible legacy data without choosing or assigning roles", async (t) => {
  for (const roles of [[], ["WORKER", "CLIENT"]]) {
    await t.test(
      roles.length ? "multiple roles" : "active without a role",
      async () => {
        const db = await createAuthDatabase({ throughMigration: "006" });
        try {
          const user = (
            await db.query(
              "INSERT INTO auth.users(email) VALUES ('legacy@example.invalid') RETURNING id",
            )
          ).rows[0].id;
          await db.query(
            "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name::text=ANY($2::text[])",
            [user, roles],
          );
          await assert.rejects(
            db.exec(await readFile(migrationUrl, "utf8")),
            invariantError,
          );
          await db.exec("ROLLBACK");
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::integer AS count FROM public.user_roles WHERE user_id=$1",
                [user],
              )
            ).rows[0].count,
            roles.length,
          );
          assert.equal(
            (
              await db.query("SELECT is_active FROM public.users WHERE id=$1", [
                user,
              ])
            ).rows[0].is_active,
            true,
          );
        } finally {
          await db.close();
        }
      },
    );
  }
});

test("setup_auth also installs 007 after historical migrations 001-004", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "004" });
  t.after(() => db.close());
  await db.exec(await readFile(setupUrl, "utf8"));
  const user = (
    await db.query(
      "INSERT INTO auth.users(email) VALUES ('setup@example.invalid') RETURNING id",
    )
  ).rows[0].id;
  await assert.rejects(
    db.query("UPDATE public.users SET is_active=true WHERE id=$1", [user]),
    invariantError,
  );
  await db.query(
    "INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name='WORKER'",
    [user],
  );
  await db.query("UPDATE public.users SET is_active=true WHERE id=$1", [user]);
});
