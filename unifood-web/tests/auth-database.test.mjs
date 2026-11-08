import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

test("institutional registration migrations execute on PostgreSQL", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const institution = (
    await db.query(
      "SELECT id FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co'",
    )
  ).rows[0].id;
  let number = 1000000;
  const register = (email) =>
    db.query(
      `INSERT INTO auth.users(email, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, '{}') RETURNING id`,
      [
        email,
        JSON.stringify({
          registration_type: "student",
          full_name: "Estudiante de prueba",
          code: String(++number),
          privacy_accepted: "true",
          role: "SUPER_ADMIN",
        }),
      ],
    );

  await t.test(
    "both domains create pending registrations in the same institution, preserving email",
    async () => {
      for (const email of [
        "maria@ustavillavo.edu.co",
        "pedro@ustavillavicencio.edu.co",
        "ANA@USTAVILLAVICENCIO.EDU.CO",
      ]) {
        const id = (await register(email)).rows[0].id;
        // Two-step registration: no client profile or role until step 2.
        const profile = (
          await db.query(
            `SELECT u.email, u.is_active, p.institution_id,
               (SELECT count(*)::int FROM public.clients c WHERE c.user_id = u.id) AS clients,
               (SELECT count(*)::int FROM public.user_roles ur WHERE ur.user_id = u.id) AS roles
             FROM public.users u JOIN public.pending_registrations p ON p.user_id = u.id
             WHERE u.id = $1`,
            [id],
          )
        ).rows;
        assert.deepEqual(profile, [
          {
            email: email.toLowerCase(),
            is_active: false,
            institution_id: institution,
            clients: 0,
            roles: 0,
          },
        ]);
      }
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM public.institutions",
          )
        ).rows[0].count,
        1,
      );
    },
  );

  await t.test(
    "public RPC accepts exact domains and case, but rejects spaces and lookalikes",
    async () => {
      await db.exec("SET ROLE anon");
      try {
        for (const email of [
          "user@ustavillavo.edu.co",
          "User@USTAVILLAVICENCIO.EDU.CO",
        ]) {
          assert.equal(
            (
              await db.query(
                "SELECT public.is_institutional_email($1) AS allowed",
                [email],
              )
            ).rows[0].allowed,
            true,
          );
        }
        for (const email of [
          "user@gmail.com",
          " User@USTAVILLAVICENCIO.EDU.CO ",
          "user@usantotomas.edu.co",
          "user@ustavillavo.edu.co.evil.com",
          "user@sub.ustavillavicencio.edu.co",
          "user@@ustavillavo.edu.co",
          "@ustavillavo.edu.co",
          "user name@ustavillavo.edu.co",
          "user@usta villavo.edu.co",
        ]) {
          assert.equal(
            (
              await db.query(
                "SELECT public.is_institutional_email($1) AS allowed",
                [email],
              )
            ).rows[0].allowed,
            false,
            email,
          );
        }
      } finally {
        await db.exec("RESET ROLE");
      }
    },
  );

  await t.test(
    "direct signup cannot bypass domain checks and rolls back rejected profiles",
    async () => {
      for (const email of [
        "user@gmail.com",
        "user@ustavillavicencio.edu.co.evil.com",
        "user@@ustavillavo.edu.co",
      ]) {
        await assert.rejects(
          register(email),
          /REGISTRATION_DOMAIN_NOT_ALLOWED/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS count FROM public.users WHERE email = $1",
              [email],
            )
          ).rows[0].count,
          0,
        );
      }
    },
  );

  await t.test(
    "Spring institution lookup resolves both domains using the same SQL function",
    async () => {
      const java = await readFile(
        new URL(
          "../../unifood-backend/src/main/java/com/santotofood/adapter/out/persistence/repository/SpringDataInstitutionRepository.java",
          import.meta.url,
        ),
        "utf8",
      );
      const query = java
        .match(/@Query\(value = """([\s\S]*?)"""/)?.[1]
        .replace(":emailDomain", "$1");
      assert.ok(query);
      for (const domain of [
        "ustavillavo.edu.co",
        " USTAVILLAVICENCIO.EDU.CO ",
      ]) {
        assert.equal((await db.query(query, [domain])).rows[0].id, institution);
      }
      assert.equal(
        (await db.query(query, ["ustavillavo.edu.co.evil.com"])).rows.length,
        0,
      );
    },
  );

  await t.test(
    "disabling the institution disables both registration domains",
    async () => {
      await db.query(
        "UPDATE public.institutions SET is_active = false WHERE id = $1",
        [institution],
      );
      for (const email of [
        "disabled@ustavillavo.edu.co",
        "disabled@ustavillavicencio.edu.co",
      ]) {
        assert.equal(
          (
            await db.query(
              "SELECT public.is_institutional_email($1) AS allowed",
              [email],
            )
          ).rows[0].allowed,
          false,
        );
        await assert.rejects(
          register(email),
          /REGISTRATION_DOMAIN_NOT_ALLOWED/,
        );
      }
    },
  );
});
