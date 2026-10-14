import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail("Missing real PostgreSQL lock/snapshot evidence");
}

test(
  "native PostgreSQL protects combined cafeteria profiles and composite item keys under races",
  { timeout: 180000 },
  async (t) => {
    const binaries = await postgresBinaries();
    assert.ok(
      binaries,
      "Native PostgreSQL is required for business integrity concurrency tests",
    );
    const db = await createNativeAuthDatabase(binaries);
    t.after(() => db.close());
    const site = randomUUID();
    await db.query(
      `INSERT INTO public.sites(id,name,city,institution_id) SELECT '${site}','native','native',id FROM public.institutions LIMIT 1;`,
    );
    async function cafe() {
      const id = randomUUID();
      await db.query(
        `INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES ('${id}','${site}','${id}',false,'07:00','08:00');`,
      );
      return id;
    }
    async function user(role) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO auth.users(id,email) VALUES ('${id}','${id}@example.invalid'); INSERT INTO public.user_roles(user_id,role_id) SELECT '${id}',id FROM public.roles WHERE name='${role}';`,
      );
      return id;
    }
    const assign = (u, c) =>
      `INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES ('${u}','${c}');`;
    let sequence = 0;
    async function race(isolation, firstWrite, secondWrite, expected) {
      const a = db.session(),
        b = db.session(),
        label = `integrity-race-${++sequence}`;
      try {
        a.write(
          `BEGIN ISOLATION LEVEL ${isolation}; ${firstWrite} SELECT 'FIRST_READY';`,
        );
        await until(() => a.output().includes("FIRST_READY"));
        b.write(
          `SET application_name='${label}'; SET statement_timeout='15s'; BEGIN ISOLATION LEVEL ${isolation}; SELECT count(*) FROM public.users; SELECT 'SNAPSHOT_READY';`,
        );
        await until(() => b.output().includes("SNAPSHOT_READY"));
        b.write(`${secondWrite} COMMIT;`);
        await until(
          async () =>
            Number(
              await db.query(
                `SELECT count(*) FROM pg_stat_activity WHERE application_name='${label}' AND wait_event_type='Lock'`,
              ),
            ) > 0,
        );
        a.write("COMMIT;");
        a.end();
        b.end();
        const [winner, loser] = await Promise.all([a.done, b.done]);
        assert.equal(winner.code, 0, winner.errors);
        assert.notEqual(
          loser.code,
          0,
          "Both incompatible writes must never commit",
        );
        assert.match(loser.errors, new RegExp(expected), loser.errors);
      } finally {
        a.end();
        b.end();
        await Promise.all([a.done, b.done]);
      }
    }
    for (const isolation of [
      "READ COMMITTED",
      "REPEATABLE READ",
      "SERIALIZABLE",
    ]) {
      await t.test(
        `${isolation}: one worker cannot be assigned concurrently to two cafeterias`,
        async () => {
          const worker = await user("WORKER"),
            a = await cafe(),
            b = await cafe();
          await race(
            isolation,
            assign(worker, a),
            assign(worker, b),
            isolation === "READ COMMITTED" ? "23505" : "40001",
          );
          assert.equal(
            await db.query(
              `SELECT count(*) FROM public.cafeteria_users WHERE user_id='${worker}'`,
            ),
            "1",
          );
        },
      );
      await t.test(
        `${isolation}: two admins cannot claim the same cafeteria`,
        async () => {
          const a = await user("ADMIN"),
            b = await user("ADMIN"),
            c = await cafe();
          await race(
            isolation,
            assign(a, c),
            assign(b, c),
            isolation === "READ COMMITTED" ? "23514" : "40001",
          );
          assert.equal(
            await db.query(
              `SELECT count(*) FROM public.cafeteria_users WHERE cafeteria_id='${c}'`,
            ),
            "1",
          );
        },
      );
      await t.test(
        `${isolation}: role changes cannot race an operational assignment`,
        async () => {
          const u = await user("WORKER"),
            c = await cafe();
          await race(
            isolation,
            `UPDATE public.user_roles SET role_id=(SELECT id FROM public.roles WHERE name='CLIENT') WHERE user_id='${u}';`,
            assign(u, c),
            isolation === "READ COMMITTED" ? "23514" : "40001",
          );
          assert.equal(
            await db.query(
              `SELECT count(*) FROM public.cafeteria_users WHERE user_id='${u}'`,
            ),
            "0",
          );
        },
      );
      await t.test(
        `${isolation}: cafeteria activation cannot race deactivation of its only admin`,
        async () => {
          const admin = await user("ADMIN"),
            c = await cafe();
          await db.query(
            `${assign(admin, c)} UPDATE public.users SET is_active=true WHERE id='${admin}';`,
          );
          await race(
            isolation,
            `UPDATE public.cafeterias SET is_active=true WHERE id='${c}';`,
            `UPDATE public.users SET is_active=false WHERE id='${admin}';`,
            isolation === "READ COMMITTED" ? "23514" : "40001",
          );
          assert.equal(
            await db.query(
              `SELECT is_active FROM public.users WHERE id='${admin}'`,
            ),
            "t",
          );
        },
      );
    }
    await t.test(
      "a concurrent lunch move cannot admit an item from the original cafeteria",
      async () => {
        const a = await cafe(),
          b = await cafe(),
          lunch = randomUUID(),
          order = randomUUID();
        await db.query(
          `INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES ('${lunch}','${a}','fixture',100,'CORRIENTE'); INSERT INTO public.orders(id,cafeteria_id,client_name,total) VALUES ('${order}','${a}','fixture',100);`,
        );
        await race(
          "READ COMMITTED",
          `UPDATE public.lunches SET cafeteria_id='${b}' WHERE id='${lunch}';`,
          `INSERT INTO public.order_items(order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES ('${order}','${lunch}','fixture',100,1,100);`,
          "23503",
        );
        assert.equal(
          await db.query(
            `SELECT count(*) FROM public.order_items WHERE order_id='${order}'`,
          ),
          "0",
        );
      },
    );
  },
);
