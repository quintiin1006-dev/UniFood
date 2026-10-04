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
  let number = 100000;
  const register = (email) =>
    db.query(
      "INSERT INTO auth.users(email, raw_user_meta_data) VALUES ($1, $2) RETURNING id",
      [
        email,
        JSON.stringify({
          registration_type: "student",
          full_name: "Estudiante de prueba",
          document: String(++number),
          role: "SUPER_ADMIN",
        }),
      ],
    );

  await t.test(
    "both domains create CLIENT profiles in the same institution, preserving email",
    async () => {
      for (const email of [
        "maria@ustavillavo.edu.co",
        "pedro@ustavillavicencio.edu.co",
        "ANA@USTAVILLAVICENCIO.EDU.CO",
      ]) {
        const id = (await register(email)).rows[0].id;
        const profile = (
          await db.query(
            `SELECT u.email, u.is_active, c.institution_id, r.name AS role FROM public.users u
        JOIN public.clients c ON c.user_id = u.id JOIN public.user_roles ur ON ur.user_id = u.id
        JOIN public.roles r ON r.id = ur.role_id WHERE u.id = $1`,
            [id],
          )
        ).rows;
        assert.deepEqual(profile, [
          {
            email: email.toLowerCase(),
            is_active: true,
            institution_id: institution,
            role: "CLIENT",
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
    "public RPC accepts exact domains, case and outer spaces, but rejects lookalikes",
    async () => {
      await db.exec("SET ROLE anon");
      try {
        for (const email of [
          "user@ustavillavo.edu.co",
          " User@USTAVILLAVICENCIO.EDU.CO ",
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
          /Invalid institutional student registration/,
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
          /Invalid institutional student registration/,
        );
      }
    },
  );
});
