import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail("Timed out waiting for PostgreSQL transaction/lock evidence");
}

test(
  "native PostgreSQL serializes activity/last-role races only for the same user",
  { timeout: 120000 },
  async (t) => {
    const binaries = await postgresBinaries();
    if (!binaries)
      return t.skip(
        "Native PostgreSQL not installed; PGlite transaction-boundary tests still run",
      );
    const db = await createNativeAuthDatabase(binaries);
    t.after(() => db.close());
    let number = 0;
    async function fixture() {
      const user = `10000000-0000-0000-0000-${String(++number).padStart(12, "0")}`;
      await db.query(`INSERT INTO auth.users(id,email) VALUES ('${user}','concurrent-${number}@example.invalid');
      INSERT INTO public.user_roles(user_id,role_id) SELECT '${user}',id FROM public.roles WHERE name='WORKER';`);
      return user;
    }
    for (const isolation of [
      "READ COMMITTED",
      "REPEATABLE READ",
      "SERIALIZABLE",
    ]) {
      for (const first of ["activate", "delete"]) {
        await t.test(
          `${isolation}: ${first} wins, conflicting transaction cannot commit`,
          async () => {
            const user = await fixture();
            const activation = `UPDATE public.users SET is_active=true WHERE id='${user}';`;
            const deletion = `DELETE FROM public.user_roles WHERE user_id='${user}';`;
            const a = db.session(),
              b = db.session();
            // Closing either psql connection aborts any uncommitted transaction, including on assertion failure.
            t.after(async () => {
              a.end();
              b.end();
              await Promise.all([a.done, b.done]);
            });
            a.write(
              `BEGIN ISOLATION LEVEL ${isolation}; ${first === "activate" ? activation : deletion} SELECT 'FIRST_PID=' || pg_backend_pid(); SELECT 'FIRST_READY';`,
            );
            await until(() => a.output().includes("FIRST_READY"));
            const firstPid = Number(a.output().match(/FIRST_PID=(\d+)/)[1]);
            assert.equal(
              await db.query(
                `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${firstPid} AND locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((public.auth_role_lock_key('${user}') >> 32) & 4294967295) AND objid::bigint=(public.auth_role_lock_key('${user}') & 4294967295));`,
              ),
              "t",
              "the writer holds the transaction advisory lock derived from this user's complete UUID",
            );
            b.write(
              `BEGIN ISOLATION LEVEL ${isolation}; SELECT 'SECOND_PID=' || pg_backend_pid(); SELECT count(*) FROM public.user_roles WHERE user_id='${user}'; ${first === "activate" ? deletion : activation} SELECT 'SECOND_WRITTEN'; COMMIT;`,
            );
            b.end();
            await until(() => b.output().includes("SECOND_PID="));
            const pid = Number(b.output().match(/SECOND_PID=(\d+)/)[1]);
            await until(
              async () =>
                (await db.query(
                  `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND NOT granted);`,
                )) === "t",
            );
            assert.ok(
              !b.output().includes("SECOND_WRITTEN"),
              "same-user conflicting write must wait before proceeding",
            );
            a.write("COMMIT;");
            a.end();
            assert.equal((await a.done).code, 0);
            const loser = await b.done;
            assert.notEqual(
              loser.code,
              0,
              "conflicting transaction must abort",
            );
            assert.match(
              loser.errors,
              isolation === "READ COMMITTED" ? /23514/ : /40001/,
            );
            assert.equal(
              await db.query(
                `SELECT is_active || ':' || (SELECT count(*) FROM public.user_roles WHERE user_id=u.id) FROM public.users u WHERE id='${user}';`,
              ),
              first === "activate" ? "true:1" : "false:0",
            );
          },
        );
      }
    }
    await t.test(
      "different users sharing a UUID prefix can both write while one transaction remains open",
      async () => {
        const first = await fixture(),
          second = await fixture();
        assert.notEqual(
          await db.query(`SELECT public.auth_role_lock_key('${first}');`),
          await db.query(`SELECT public.auth_role_lock_key('${second}');`),
        );
        const a = db.session();
        t.after(async () => {
          a.end();
          await a.done;
        });
        a.write(
          `BEGIN; UPDATE public.users SET is_active=true WHERE id='${first}'; SELECT 'FIRST_READY';`,
        );
        await until(() => a.output().includes("FIRST_READY"));
        // A remains open. This must complete without waiting for A's advisory/row locks.
        await db.query(
          `SET statement_timeout='3s'; UPDATE public.users SET is_active=true WHERE id='${second}';`,
        );
        a.write("COMMIT;");
        a.end();
        assert.equal((await a.done).code, 0);
      },
    );
  },
);
