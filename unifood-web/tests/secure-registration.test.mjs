import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createAuthDatabase as createFixtureDatabase } from "./helpers/auth-database.mjs";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

// The real 018: no simulated server preauthorization, unlike other test files.
const createAuthDatabase = (options = {}) =>
  createFixtureDatabase({ ...options, simulateServerPreauthorization: false });

const student = "1234567";
const migrationUrl = new URL(
  "../../unifood-backend/supabase/migrations/018_secure_registration.sql",
  import.meta.url,
);
const setupUrl = new URL(
  "../../unifood-backend/supabase/setup_auth.sql",
  import.meta.url,
);

// Step 1, a public signup: app metadata is empty because the browser cannot write it.
async function signup(db, email, meta = {}) {
  return (
    await db.query(
      `INSERT INTO auth.users(email, raw_user_meta_data, raw_app_meta_data, encrypted_password)
       VALUES ($1, $2, '{}', 'hash-signup') RETURNING id`,
      [email, JSON.stringify(meta)],
    )
  ).rows[0].id;
}
const confirm = (db, id) =>
  db.query("UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1", [
    id,
  ]);
const changePassword = (db, id) =>
  db.query(
    "UPDATE auth.users SET encrypted_password = 'hash-new' WHERE id = $1",
    [id],
  );
// Confirmed and with the password updated in Auth since signup: ready for step 2.
// Only the hash changes; bcrypt salts make it change even for the same password.
async function ready(db, email) {
  const id = await signup(db, email);
  await confirm(db, id);
  await changePassword(db, id);
  return id;
}

// A session for uid. amr is how Auth issued it: "otp" after verifying an emailed code,
// "password" after a password login, or null for no JWT claims at all.
async function as(db, role, uid, sql, params = [], amr = "otp") {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    `SELECT set_config('request.jwt.claim.sub', $1, false),
            set_config('request.jwt.claims', $2, false)`,
    [
      uid ?? "",
      amr === null
        ? ""
        : JSON.stringify({ sub: uid, amr: [{ method: amr, timestamp: 1 }] }),
    ],
  );
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("RESET ROLE");
  }
}
// Step 2, with the user's own session.
const complete = (
  db,
  uid,
  { name = "Ana Torres", code = student, privacy = true, amr = "otp" } = {},
) =>
  as(
    db,
    "authenticated",
    uid,
    "SELECT public.complete_registration($1, $2, $3)",
    [name, code, privacy],
    amr,
  );

const fails = (pattern) => (error) => {
  assert.match(error.message, pattern);
  return true;
};
const denied = (error) => error.code === "42501";
const one = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];
const count = async (db, table) =>
  (await one(db, `SELECT count(*)::int AS n FROM ${table}`)).n;

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail("Timed out waiting for PostgreSQL lock evidence");
}

test("018 fails with a clear message when pg_cron is missing", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "017" });
  t.after(() => db.close());
  await db.exec("DROP SCHEMA cron CASCADE");
  await assert.rejects(
    db.exec(await readFile(migrationUrl, "utf8")),
    fails(/needs the pg_cron extension/),
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (await one(db, "SELECT to_regclass('public.institution_email_domains') t"))
      .t,
    null,
  );
});

test("signup accepts institutional emails only and creates no profile", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  for (const [email, type] of [
    ["nombre@ustavillavo.edu.co", "STUDENT"],
    ["NOMBRE2@USTAVILLAVO.EDU.CO", "STUDENT"],
    ["a.b-c_d@ustavillavicencio.edu.co", "STAFF"],
  ]) {
    const id = await signup(db, email);
    assert.deepEqual(
      await one(
        db,
        `SELECT u.email, u.is_active, p.client_type, p.preauthorized
         FROM public.users u JOIN public.pending_registrations p ON p.user_id = u.id
         WHERE u.id = $1`,
        [id],
      ),
      {
        email: email.toLowerCase(),
        is_active: false,
        client_type: type,
        preauthorized: false,
      },
    );
  }
  assert.equal(await count(db, "public.clients"), 0);
  assert.equal(await count(db, "public.user_roles"), 0);

  const users = await count(db, "public.users");
  for (const email of [
    "nombre@ustavillavo.edu.co.evil.com",
    "nombre@evilustavillavo.edu.co",
    "nombre@sub.ustavillavo.edu.co",
    "nombre@ustavillavo.edu.co.",
    "nombre@ustavillavo.edu",
    "a@b@ustavillavo.edu.co",
    "nombre+alias@ustavillavo.edu.co",
    "nombre+alias@ustavillavicencio.edu.co",
    " nombre@ustavillavo.edu.co",
    "nombre@ustavillavo.edu.co ",
    "nom bre@ustavillavo.edu.co",
    "nombre@usta villavo.edu.co",
    "nombre@ustavillavо.edu.co",
    "ñandú@ustavillavo.edu.co",
    ".@ustavillavicencio.edu.co",
    ".ana@ustavillavo.edu.co",
    "ana.@ustavillavo.edu.co",
    "a..n.a@ustavillavicencio.edu.co",
    "nombre@gmail.com",
    "nombre",
    "",
  ])
    await assert.rejects(
      signup(db, email),
      fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
      String(email),
    );
  assert.equal(await count(db, "public.users"), users);
});

test("signup metadata is ignored, whatever its type", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // The old flow trusted these fields, and a browser can still send them.
  const meta = {
    full_name: ["Ana"],
    code: 1234567,
    privacy_accepted: true,
    registration_type: "student",
    role: "SUPER_ADMIN",
    unifood_provisioned: "true",
  };
  const id = await signup(db, "ana@ustavillavo.edu.co", meta);
  assert.equal(await count(db, "public.clients"), 0);
  assert.equal(await count(db, "public.user_roles"), 0);
  assert.deepEqual(
    (
      await one(db, "SELECT raw_user_meta_data m FROM auth.users WHERE id=$1", [
        id,
      ])
    ).m,
    meta,
  );
  // A mark in user metadata never bypasses the domain rule.
  await assert.rejects(
    signup(db, "worker@cafeteria.example", { unifood_provisioned: true }),
    fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
  );
});

test("confirmation only records the date; the account stays inactive", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await signup(db, "ana@ustavillavo.edu.co");
  await confirm(db, id);
  assert.deepEqual(
    await one(
      db,
      `SELECT is_active, email_confirmed_at IS NOT NULL AS confirmed
       FROM public.users WHERE id = $1`,
      [id],
    ),
    { is_active: false, confirmed: true },
  );
});

test("step 2 requires confirmation and a password updated since signup", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await signup(db, "ana@ustavillavo.edu.co");
  await assert.rejects(
    complete(db, id),
    fails(/REGISTRATION_EMAIL_NOT_CONFIRMED/),
  );
  await confirm(db, id);
  // Whoever signed up first with this address chose that password (finding F2):
  // the stored hash must have changed, whatever the new password is.
  await assert.rejects(
    complete(db, id),
    fails(/REGISTRATION_PASSWORD_CHANGE_REQUIRED/),
  );
  await changePassword(db, id);
  await complete(db, id);
  assert.equal(
    (await one(db, "SELECT is_active FROM public.users WHERE id=$1", [id]))
      .is_active,
    true,
  );
});

test("step 2 needs a session issued by verifying the emailed code", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await ready(db, "ana@ustavillavo.edu.co");
  // Whoever chose the signup password can log in with it once the owner confirms;
  // that password session never finishes the registration.
  for (const amr of ["password", "oauth", null])
    await assert.rejects(
      complete(db, id, { amr }),
      fails(/REGISTRATION_OTP_SESSION_REQUIRED/),
      String(amr),
    );
  assert.equal(await count(db, "public.clients"), 0);
  await complete(db, id, { amr: "otp" });
});

test("step 2 stores name, code and privacy, and activates as CLIENT", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await ready(db, "ana@ustavillavo.edu.co");
  await complete(db, id, {
    name: "  María  José O'Neil-Peña ",
    code: "0012345",
  });
  const row = await one(
    db,
    `SELECT u.is_active, c.full_name, c.institutional_code, c.client_type,
            c.privacy_accepted_at IS NOT NULL AS privacy, r.name AS role
     FROM public.users u
     JOIN public.clients c ON c.user_id = u.id
     JOIN public.user_roles ur ON ur.user_id = u.id
     JOIN public.roles r ON r.id = ur.role_id
     WHERE u.id = $1`,
    [id],
  );
  assert.deepEqual(row, {
    is_active: true,
    full_name: "María José O'Neil-Peña",
    institutional_code: "0012345",
    client_type: "STUDENT",
    privacy: true,
    role: "CLIENT",
  });
  assert.equal(await count(db, "public.pending_registrations"), 0);
});

test("step 2 works only once and only for the caller's account", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const ana = await ready(db, "ana@ustavillavo.edu.co");
  const eva = await ready(db, "eva@ustavillavo.edu.co");
  await complete(db, ana);
  await assert.rejects(complete(db, ana), fails(/REGISTRATION_NOT_PENDING/));
  // There is no target parameter: Ana's session cannot complete Eva's account.
  assert.deepEqual(
    await one(
      db,
      "SELECT is_active, (SELECT count(*)::int FROM public.clients WHERE user_id = $1) AS clients FROM public.users WHERE id = $1",
      [eva],
    ),
    { is_active: false, clients: 0 },
  );
  await assert.rejects(
    as(
      db,
      "authenticated",
      null,
      "SELECT public.complete_registration('Ana Torres', '7654321', true)",
    ),
    fails(/REGISTRATION_NOT_AUTHENTICATED/),
  );
  await assert.rejects(
    as(
      db,
      "anon",
      null,
      "SELECT public.complete_registration('Ana Torres', '7654321', true)",
    ),
    denied,
  );
});

test("names must be readable text, with no blanks, markup or hidden characters", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await ready(db, "ana@ustavillavo.edu.co");
  for (const name of [
    null,
    "",
    "   ",
    "AB",
    "\t\t\t",
    "Ana\tTorres",
    "Ana\nTorres",
    "​​​",
    "Ana​Torres",
    "‮AIRETEFAC",
    "Ana Torres",
    "<img src=x onerror=1>",
    "Ana Torres 2",
    "123",
    "A".repeat(151),
  ])
    await assert.rejects(
      complete(db, id, { name }),
      fails(/REGISTRATION_INVALID_NAME/),
      JSON.stringify(name),
    );
  await assert.rejects(
    complete(db, id, { privacy: false }),
    fails(/REGISTRATION_PRIVACY_REQUIRED/),
  );
  await assert.rejects(
    complete(db, id, { privacy: null }),
    fails(/REGISTRATION_PRIVACY_REQUIRED/),
  );
  await complete(db, id, { name: "Ñandú Pérez" });
});

test("student code is mandatory, numeric and exactly 7 digits", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await ready(db, "ana@ustavillavo.edu.co");
  for (const code of [
    null,
    "",
    "  ",
    "123456",
    "12345678",
    "12345a7",
    "123 567",
    "１２３４５６７",
  ])
    await assert.rejects(
      complete(db, id, { code }),
      fails(/REGISTRATION_INVALID_CODE/),
      String(code),
    );
  await complete(db, id, { code: "0012345" });
});

test("staff code is optional, numeric and between 5 and 12 digits", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  let sequence = 0;
  const staff = () => ready(db, `profe${++sequence}@ustavillavicencio.edu.co`);
  const first = await staff();
  for (const code of ["1234", "1234567890123", "12a45"])
    await assert.rejects(
      complete(db, first, { name: "Profe Uno", code }),
      fails(/REGISTRATION_INVALID_CODE/),
      code,
    );
  for (const code of [null, "", "12345", "123456789012"])
    await complete(db, await staff(), { name: "Profe Dos", code });
  const codes = (
    await db.query(
      `SELECT institutional_code, client_type FROM public.clients
       ORDER BY institutional_code NULLS FIRST`,
    )
  ).rows;
  assert.deepEqual(
    codes.map((row) => row.institutional_code),
    [null, null, "12345", "123456789012"],
  );
  assert.ok(codes.every((row) => row.client_type === "STAFF"));
});

test("codes are reserved in step 2 and unique per institution", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // Signing up never reserves a code, so a mailbox nobody reads holds nothing (F3).
  await signup(db, "ghost@ustavillavo.edu.co", { code: student });
  const ana = await ready(db, "ana@ustavillavo.edu.co");
  await complete(db, ana);
  const eva = await ready(db, "eva@ustavillavo.edu.co");
  await assert.rejects(
    complete(db, eva),
    fails(/REGISTRATION_CODE_UNAVAILABLE/),
  );
  const profe = await ready(db, "profe@ustavillavicencio.edu.co");
  await assert.rejects(
    complete(db, profe, { name: "Profe Uno" }),
    fails(/REGISTRATION_CODE_UNAVAILABLE/),
  );
  // A failed attempt leaves the registration pending, so it can be retried.
  await complete(db, eva, { code: "7654321" });

  const other = (
    await db.query(
      `INSERT INTO public.institutions (name, brand_name, email_domain)
       VALUES ('Otra', 'Otra', 'otra.edu.co') RETURNING id`,
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.institution_email_domains
     VALUES ('otra.edu.co', $1, 'STUDENT', true, 7, 7)`,
    [other],
  );
  await complete(db, await ready(db, "ana@otra.edu.co"));
});

test("a deactivation before step 2 is not undone by it", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await ready(db, "ana@ustavillavo.edu.co");
  // The account is already inactive; this direct write still records the decision (F6).
  await db.query("UPDATE public.users SET is_active = false WHERE id = $1", [
    id,
  ]);
  await assert.rejects(
    complete(db, id),
    fails(/REGISTRATION_ACCOUNT_DISABLED/),
  );
  await db.query(
    "UPDATE public.users SET deactivated_at = NULL WHERE id = $1",
    [id],
  );
  await complete(db, id);
  await db.query("UPDATE public.users SET is_active = false WHERE id = $1", [
    id,
  ]);
  assert.notEqual(
    (await one(db, "SELECT deactivated_at FROM public.users WHERE id=$1", [id]))
      .deactivated_at,
    null,
  );
});

test("only a server preauthorization creates identities outside the domain rule", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // As the Admin API: metadata arrives after the INSERT, so it never counts (F1).
  await assert.rejects(
    signup(db, "worker@cafeteria.example"),
    fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
  );
  // The old app_metadata mark no longer opens anything, even if it were present.
  for (const mark of [
    { unifood_provisioned: true },
    { unifood_provisioned: "true" },
  ])
    await assert.rejects(
      db.query(
        "INSERT INTO auth.users(email, raw_app_meta_data) VALUES ($1, $2)",
        ["worker@cafeteria.example", JSON.stringify(mark)],
      ),
      fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
    );
  // The fixture column default carries the mark too: still rejected.
  await assert.rejects(
    db.query(
      "INSERT INTO auth.users(email) VALUES ('worker@cafeteria.example')",
    ),
    fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
  );
  assert.equal(await count(db, "public.users"), 0);
  await db.query(
    "SELECT public.preauthorize_identity('Worker@Cafeteria.example', 'WORKER')",
  );
  const worker = await signup(db, "worker@cafeteria.example");
  assert.deepEqual(
    await one(db, "SELECT is_active FROM public.users WHERE id = $1", [worker]),
    { is_active: false },
  );
  assert.equal(await count(db, "public.pending_registrations"), 0);
  // Single use.
  assert.equal(await count(db, "public.identity_preauthorizations"), 0);

  await db.query(
    "SELECT public.preauthorize_identity('late@cafeteria.example', 'WORKER')",
  );
  await db.query(
    `UPDATE public.identity_preauthorizations
     SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute'`,
  );
  await assert.rejects(
    signup(db, "late@cafeteria.example"),
    fails(/REGISTRATION_DOMAIN_NOT_ALLOWED/),
  );
  await assert.rejects(
    db.query("SELECT public.preauthorize_identity('x@y.example', 'CLIENT')"),
    fails(/chk_preauth_client_scope/),
  );
  await assert.rejects(
    db.query(
      "SELECT public.preauthorize_identity('x@y.example', 'WORKER', NULL, NULL, interval '2 hours')",
    ),
    fails(/chk_preauth_lifetime/),
  );

  // A demo client: any address the owner controls, institution chosen by the server.
  const institution = (
    await one(
      db,
      "SELECT id FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co'",
    )
  ).id;
  await db.query(
    "SELECT public.preauthorize_identity('demo@example.com', 'CLIENT', $1, 'STUDENT')",
    [institution],
  );
  const demo = await ready(db, "demo@example.com");
  // Created by the server, so it may finish from a password login.
  await complete(db, demo, {
    name: "Demo Uno",
    code: "7999999",
    amr: "password",
  });
  assert.deepEqual(
    await one(
      db,
      "SELECT c.client_type, u.is_active FROM public.clients c JOIN public.users u ON u.id = c.user_id WHERE u.id = $1",
      [demo],
    ),
    { client_type: "STUDENT", is_active: true },
  );
});

test("no identity can change its email address", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const ana = await signup(db, "ana@ustavillavo.edu.co");
  await db.query(
    "SELECT public.preauthorize_identity('worker@cafeteria.example', 'WORKER')",
  );
  const worker = await signup(db, "worker@cafeteria.example");
  for (const [id, email] of [
    [ana, "ana@gmail.com"],
    [ana, "ana@ustavillavicencio.edu.co"],
    [worker, "worker@other.example"],
  ])
    await assert.rejects(
      db.query("UPDATE auth.users SET email = $2 WHERE id = $1", [id, email]),
      fails(/REGISTRATION_EMAIL_CHANGE_NOT_ALLOWED/),
    );
  await db.query(
    "UPDATE auth.users SET email = 'ANA@ustavillavo.edu.co' WHERE id = $1",
    [ana],
  );
});

test("browser roles cannot write account columns, even with Supabase default grants", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "000" });
  t.after(() => db.close());
  // Supabase grants every new public object to the API roles; 001-018 must undo it.
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
  const directory = new URL(
    "../../unifood-backend/supabase/migrations/",
    import.meta.url,
  );
  for (const name of (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL(name, directory), "utf8"));

  const columns = [
    ["public.clients", "client_type"],
    ["public.clients", "institutional_code"],
    ["public.clients", "code_review_required"],
    ["public.clients", "privacy_accepted_at"],
    ["public.users", "is_active"],
    ["public.users", "must_change_password"],
    ["public.users", "deactivated_at"],
  ];
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["public.clients", "public.users"])
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
        assert.equal(
          (
            await one(db, "SELECT has_table_privilege($1, $2, $3) AS ok", [
              role,
              table,
              privilege,
            ])
          ).ok,
          false,
          `${role} ${privilege} ${table}`,
        );
    for (const [table, column] of columns)
      assert.equal(
        (
          await one(
            db,
            "SELECT has_column_privilege($1, $2, $3, 'UPDATE') AS ok",
            [role, table, column],
          )
        ).ok,
        false,
        `${role} UPDATE ${table}.${column}`,
      );
  }
  assert.deepEqual(
    (
      await db.query(
        `SELECT c.relname, c.relrowsecurity,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
         WHERE c.oid IN ('public.users'::regclass, 'public.clients'::regclass)
         ORDER BY 1`,
      )
    ).rows,
    [
      { relname: "clients", relrowsecurity: true, policies: 0 },
      { relname: "users", relrowsecurity: true, policies: 0 },
    ],
  );

  // And the attempt itself, with the user's own session.
  const id = await signup(db, "ana@ustavillavo.edu.co");
  for (const sql of [
    "UPDATE public.users SET is_active = true WHERE id = $1",
    "UPDATE public.users SET deactivated_at = NULL WHERE id = $1",
    "UPDATE public.users SET must_change_password = false WHERE id = $1",
    "UPDATE public.clients SET institutional_code = '7000001' WHERE user_id = $1",
  ])
    await assert.rejects(as(db, "authenticated", id, sql, [id]), denied, sql);
});

test("browser and service roles reach only the public entry points", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "017" });
  t.after(() => db.close());
  // Supabase grants new public objects to these roles by default; 018 must revoke them.
  await db.exec(`
    CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  await db.exec(await readFile(migrationUrl, "utf8"));
  const pending = await signup(db, "ana@ustavillavo.edu.co");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const sql of [
      "SELECT * FROM public.institution_email_domains",
      "SELECT * FROM public.identity_preauthorizations",
      "SELECT * FROM public.pending_registrations",
      "SELECT * FROM public.client_code_corrections",
      "SELECT * FROM public.registration_cleanup_settings",
      "SELECT * FROM public.registration_cleanup_log",
      "SELECT institutional_code FROM public.clients",
      "INSERT INTO public.identity_preauthorizations (email, role_name, expires_at) VALUES ('a@b.co', 'WORKER', now())",
      "SELECT public.registration_domain_rule('a@ustavillavo.edu.co')",
      "SELECT * FROM public.institution_code_rule(gen_random_uuid(), 'STUDENT')",
      "SELECT public.valid_institutional_code('1', 1::smallint, 1::smallint)",
      "SELECT public.normalized_person_name('Ana')",
      "SELECT public.preauthorize_identity('a@b.co', 'WORKER')",
      "SELECT public.purge_unconfirmed_accounts()",
      "SELECT public.admin_set_client_code(gen_random_uuid(), NULL, 'motivo', gen_random_uuid())",
    ])
      await assert.rejects(
        as(db, role, pending, sql),
        denied,
        `${role}: ${sql}`,
      );
  }
  for (const role of ["anon", "authenticated"]) {
    for (const email of ["ana@ustavillavo.edu.co", "ANA@USTAVILLAVO.EDU.CO"])
      assert.equal(
        (
          await as(
            db,
            role,
            null,
            "SELECT public.is_institutional_email($1) ok",
            [email],
          )
        ).rows[0].ok,
        true,
      );
    for (const email of [
      "ana@ustavillavo.edu.co.evil.com",
      "ana@evilustavillavo.edu.co",
      "ana+x@ustavillavo.edu.co",
      " ana@ustavillavo.edu.co",
    ])
      assert.deepEqual(
        (
          await as(db, role, null, "SELECT public.registration_rules($1) r", [
            email,
          ])
        ).rows[0].r,
        { allowed: false },
      );
    assert.deepEqual(
      (
        await as(db, role, null, "SELECT public.registration_rules($1) r", [
          "profe@ustavillavicencio.edu.co",
        ])
      ).rows[0].r,
      {
        allowed: true,
        clientType: "STAFF",
        codeRequired: false,
        minCodeLength: 5,
        maxCodeLength: 12,
      },
    );
  }
  await assert.rejects(
    as(db, "anon", null, "SELECT public.pending_registration()"),
    denied,
  );
  assert.deepEqual(
    (
      await as(
        db,
        "authenticated",
        pending,
        "SELECT public.pending_registration() r",
      )
    ).rows[0].r,
    {
      pending: true,
      emailConfirmed: false,
      clientType: "STUDENT",
      codeRequired: true,
      minCodeLength: 7,
      maxCodeLength: 7,
    },
  );
});

test("cleanup deletes registrations unfinished after 24 hours, in bounded and logged runs", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const unconfirmed = await signup(db, "old1@ustavillavo.edu.co");
  // Confirmed, but step 2 never finished: it cannot operate and is removed too.
  const incomplete = await ready(db, "old2@ustavillavo.edu.co");
  // Same, but something points at it: kept.
  const referenced = await ready(db, "old3@ustavillavo.edu.co");
  await db.query(
    "INSERT INTO public.notification_preferences (user_id) VALUES ($1)",
    [referenced],
  );
  const finished = await ready(db, "done@ustavillavo.edu.co");
  await complete(db, finished);
  const recent = await signup(db, "recent@ustavillavo.edu.co");
  await db.query(
    "SELECT public.preauthorize_identity('worker@cafeteria.example', 'WORKER')",
  );
  const worker = await signup(db, "worker@cafeteria.example");
  await db.query(
    `UPDATE public.pending_registrations SET created_at = now() - interval '25 hours'
     WHERE user_id = ANY($1)`,
    [[unconfirmed, incomplete, referenced]],
  );
  const purge = async () =>
    (await one(db, "SELECT public.purge_unconfirmed_accounts() n")).n;

  await db.query(
    "UPDATE public.registration_cleanup_settings SET enabled = false",
  );
  assert.equal(await purge(), 0);
  await db.query(
    "UPDATE public.registration_cleanup_settings SET enabled = true, batch_limit = 1",
  );
  assert.equal(await purge(), 1);
  assert.equal(await purge(), 1);
  assert.equal(await purge(), 0);

  const left = (
    await db.query("SELECT id FROM auth.users WHERE id = ANY($1)", [
      [unconfirmed, incomplete, referenced, finished, recent, worker],
    ])
  ).rows.map((row) => row.id);
  assert.deepEqual(left.sort(), [referenced, finished, recent, worker].sort());
  // The log keeps the domain and whether it was confirmed, never the address.
  assert.deepEqual(
    (
      await db.query(
        `SELECT email_domain, was_confirmed FROM public.registration_cleanup_log
         ORDER BY was_confirmed`,
      )
    ).rows,
    [
      { email_domain: "ustavillavo.edu.co", was_confirmed: false },
      { email_domain: "ustavillavo.edu.co", was_confirmed: true },
    ],
  );
  assert.deepEqual(
    (
      await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'registration_cleanup_log'
         ORDER BY ordinal_position`,
      )
    ).rows.map((row) => row.column_name),
    [
      "id",
      "run_at",
      "user_id",
      "email_domain",
      "registered_at",
      "was_confirmed",
    ],
  );
  await assert.rejects(
    db.query(
      "UPDATE public.registration_cleanup_settings SET max_age = interval '1 hour'",
    ),
    fails(/chk_cleanup_max_age/),
  );
  await assert.rejects(
    db.query("INSERT INTO public.registration_cleanup_settings VALUES (false)"),
    fails(/chk_cleanup_singleton/),
  );
});

test("cleanup checks every table that references an account", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // A migration that adds a reference to users or clients must update the cleanup.
  const references = (
    await db.query(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f'
         AND c.confrelid IN ('public.users'::regclass, 'public.clients'::regclass)
       ORDER BY 1, 2`,
    )
  ).rows.map((row) => `${row.tbl}.${row.col}`);
  assert.deepEqual(references, [
    // 022: only a SUPER_ADMIN writes them, so the user_roles check below covers them.
    "cafeteria_billing_settings.updated_by",
    "cafeteria_settings_audit.changed_by",
    "cafeteria_users.user_id",
    "client_code_corrections.actor_id",
    "client_code_corrections.client_id",
    "clients.user_id",
    "notification_preferences.user_id",
    "notifications.user_id",
    "orders.client_id",
    // 021: whoever rejects is a WORKER, so the user_roles check below covers it.
    "orders.rejected_by",
    "pending_registrations.user_id",
    "user_roles.user_id",
  ]);
  const source = (
    await one(
      db,
      "SELECT prosrc FROM pg_proc WHERE proname = 'purge_unconfirmed_accounts'",
    )
  ).prosrc;
  // Orders point at clients, so the clients check covers them.
  for (const check of [
    "public.clients x WHERE x.user_id",
    "public.user_roles x WHERE x.user_id",
    "public.cafeteria_users x WHERE x.user_id",
    "public.notifications x WHERE x.user_id",
    "public.notification_preferences x WHERE x.user_id",
    "public.client_code_corrections x WHERE x.actor_id",
  ])
    assert.ok(source.includes(check), check);
});

test("staging-check.sql passes on 018 and flags an uncovered account reference", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const script = await readFile(
    new URL("../../scripts/supabase/staging-check.sql", import.meta.url),
    "utf8",
  );
  const run = async () => {
    const [migrations, checks, uncovered] = await db.exec(script);
    return {
      missing: migrations.rows.filter((row) => !row.applied),
      failing: checks.rows.filter((row) => !row.ok).map((row) => row.object),
      uncovered: uncovered.rows.map((row) => row.uncovered_account_foreign_key),
    };
  };
  // The test fixture provides pg_cron's objects but not the extension itself.
  assert.deepEqual(await run(), {
    missing: [],
    failing: ["pg_cron extension"],
    uncovered: [],
  });
  await db.exec(
    "CREATE TABLE public.future_table (user_id uuid REFERENCES public.users(id))",
  );
  const result = await run();
  assert.ok(
    result.failing.includes(
      "every account foreign key is covered by the cleanup",
    ),
  );
  assert.deepEqual(result.uncovered, ["future_table.user_id"]);
});

test("the cleanup job is scheduled once, even if scheduling runs again", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const jobs = async () =>
    (await db.query("SELECT jobname, schedule, command FROM cron.job")).rows;
  const expected = [
    {
      jobname: "unifood_purge_unconfirmed_accounts",
      schedule: "17 * * * *",
      command: "SELECT public.purge_unconfirmed_accounts()",
    },
  ];
  assert.deepEqual(await jobs(), expected);
  const source = await readFile(migrationUrl, "utf8");
  const start = source.indexOf("-- Hourly cleanup.");
  const block = source.slice(start, source.indexOf("COMMIT;", start));
  await db.exec(block);
  await db.exec(block);
  assert.deepEqual(await jobs(), expected);
});

test("SUPER_ADMIN releases and assigns a code with an append-only audit", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  // As the server would: preauthorize, then create the identity.
  await db.query(
    "SELECT public.preauthorize_identity('root@example.invalid', 'SUPER_ADMIN')",
  );
  const actor = (
    await db.query(
      "INSERT INTO auth.users(email) VALUES ('root@example.invalid') RETURNING id",
    )
  ).rows[0].id;
  await db.exec("BEGIN");
  await db.query(
    `INSERT INTO public.user_roles (user_id, role_id)
     SELECT $1, id FROM public.roles WHERE name = 'SUPER_ADMIN'`,
    [actor],
  );
  await db.query("UPDATE public.users SET is_active = true WHERE id = $1", [
    actor,
  ]);
  await db.exec("COMMIT");

  const wrong = await ready(db, "wrong@ustavillavo.edu.co");
  await complete(db, wrong);
  const wrongClient = (
    await one(db, "SELECT id FROM public.clients WHERE user_id = $1", [wrong])
  ).id;
  const set = (client, code, reason = "Reclamo con carné", who = actor) =>
    db.query("SELECT public.admin_set_client_code($1, $2, $3, $4)", [
      client,
      code,
      reason,
      who,
    ]);

  // An unconfirmed SUPER_ADMIN cannot correct codes (F14).
  await assert.rejects(set(wrongClient, null), denied);
  await confirm(db, actor);
  await assert.rejects(set(wrongClient, null, "Reclamo", wrong), denied);
  await assert.rejects(
    set(wrongClient, null, "x"),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    set(wrongClient, "123"),
    (error) => error.code === "23514",
  );

  await set(wrongClient, null);
  assert.deepEqual(
    await one(
      db,
      "SELECT institutional_code, code_review_required FROM public.clients WHERE id = $1",
      [wrongClient],
    ),
    { institutional_code: null, code_review_required: true },
  );
  // The real owner can now use the released code.
  await complete(db, await ready(db, "owner@ustavillavo.edu.co"));
  await assert.rejects(
    set(wrongClient, student),
    (error) => error.code === "23505",
  );
  await set(wrongClient, "7654321");
  assert.deepEqual(
    (
      await db.query(
        `SELECT previous_code, new_code, actor_id = $1 AS by_actor, db_user
         FROM public.client_code_corrections ORDER BY created_at, new_code NULLS FIRST`,
        [actor],
      )
    ).rows,
    [
      {
        previous_code: student,
        new_code: null,
        by_actor: true,
        db_user: "postgres",
      },
      {
        previous_code: null,
        new_code: "7654321",
        by_actor: true,
        db_user: "postgres",
      },
    ],
  );

  // Append-only (F9): only the FK cascade may clear client_id.
  for (const sql of [
    "UPDATE public.client_code_corrections SET reason = 'Otra razón'",
    "UPDATE public.client_code_corrections SET client_id = NULL, reason = 'Otra razón'",
    "DELETE FROM public.client_code_corrections",
    "TRUNCATE public.client_code_corrections",
  ])
    await assert.rejects(db.query(sql), fails(/append-only/), sql);
  await db.query("DELETE FROM auth.users WHERE id = $1", [wrong]);
  assert.deepEqual(
    (await db.query("SELECT client_id FROM public.client_code_corrections"))
      .rows,
    [{ client_id: null }, { client_id: null }],
  );
});

test("upgrading from 017 keeps legacy accounts and validates the student CHECK", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "017" });
  t.after(() => db.close());
  const legacy = async (email, document, confirmed) =>
    (
      await db.query(
        `INSERT INTO auth.users(email, email_confirmed_at, raw_user_meta_data)
         VALUES ($1, $2, $3) RETURNING id`,
        [
          email,
          confirmed ? "2026-01-01T00:00:00Z" : null,
          JSON.stringify({
            registration_type: "student",
            full_name: "Cuenta previa",
            document,
          }),
        ],
      )
    ).rows[0].id;
  const confirmed = await legacy("real@ustavillavo.edu.co", "DOC-11111", true);
  const pending = await legacy("otra@ustavillavo.edu.co", "DOC-22222", false);
  const staff = await legacy(
    "profe@ustavillavicencio.edu.co",
    "DOC-33333",
    true,
  );
  const worker = (
    await db.query(
      "INSERT INTO auth.users(email) VALUES ('worker@example.invalid') RETURNING id",
    )
  ).rows[0].id;

  await db.exec(await readFile(migrationUrl, "utf8"));

  const client = (id) =>
    one(
      db,
      `SELECT u.is_active, u.deactivated_at IS NULL AS not_disabled, c.client_type,
              c.institutional_code, c.code_review_required, c.document,
              u.email_confirmed_at IS NOT NULL AS confirmed
       FROM public.users u JOIN public.clients c ON c.user_id = u.id
       WHERE u.id = $1`,
      [id],
    );
  assert.deepEqual(await client(confirmed), {
    is_active: true,
    not_disabled: true,
    client_type: "STUDENT",
    institutional_code: null,
    code_review_required: true,
    document: "DOC-11111",
    confirmed: true,
  });
  assert.deepEqual(await client(pending), {
    is_active: false,
    not_disabled: true,
    client_type: "STUDENT",
    institutional_code: null,
    code_review_required: true,
    document: "DOC-22222",
    confirmed: false,
  });
  assert.deepEqual(await client(staff), {
    is_active: true,
    not_disabled: true,
    client_type: "STAFF",
    institutional_code: null,
    code_review_required: false,
    document: "DOC-33333",
    confirmed: true,
  });
  assert.equal(
    (
      await one(db, "SELECT is_active FROM public.users WHERE id = $1", [
        worker,
      ])
    ).is_active,
    false,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT convalidated FROM pg_constraint WHERE conname = 'chk_clients_student_code'",
      )
    ).convalidated,
    true,
  );
  // Legacy accounts have no pending registration, so the cleanup never deletes them.
  assert.equal(await count(db, "public.pending_registrations"), 0);
});

test("018 aborts on a client with an unknown domain and changes nothing", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "017" });
  t.after(() => db.close());
  const id = (
    await db.query(
      `INSERT INTO auth.users(email, raw_user_meta_data) VALUES ($1, $2) RETURNING id`,
      [
        "real@ustavillavo.edu.co",
        JSON.stringify({
          registration_type: "student",
          full_name: "Cuenta previa",
          document: "DOC-11111",
        }),
      ],
    )
  ).rows[0].id;
  await db.query(
    "UPDATE public.users SET email = 'x@gmail.com' WHERE id = $1",
    [id],
  );
  await assert.rejects(
    db.exec(await readFile(migrationUrl, "utf8")),
    /outside institution_email_domains/,
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (await one(db, "SELECT to_regclass('public.institution_email_domains') t"))
      .t,
    null,
  );
});

test(
  "native PostgreSQL lets only one of two concurrent step 2 calls claim a code",
  { timeout: 120000 },
  async (t) => {
    const binaries = await postgresBinaries();
    if (!binaries) return t.skip("Native PostgreSQL is not installed");
    const db = await createNativeAuthDatabase(binaries, {
      simulateServerPreauthorization: false,
    });
    t.after(() => db.close());
    const ids = (
      await db.query(`
        INSERT INTO auth.users(email, raw_app_meta_data, encrypted_password)
        VALUES ('first@ustavillavo.edu.co', '{}', 'hash-signup'),
               ('second@ustavillavo.edu.co', '{}', 'hash-signup');
        UPDATE auth.users SET email_confirmed_at = now(), encrypted_password = 'hash-new';
        SELECT id FROM auth.users ORDER BY email;`)
    ).split(/\r?\n/);
    const step2 = (id) => `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${id}', false);
      SELECT set_config('request.jwt.claims', '{"amr": [{"method": "otp"}]}', false);
      SELECT public.complete_registration('Ana Torres', '${student}', true);`;

    const first = db.session();
    const second = db.session();
    first.write(`BEGIN; ${step2(ids[0])}`);
    await until(async () =>
      (
        await db.query(
          "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'",
        )
      ).startsWith("1"),
    );
    second.write(step2(ids[1]));
    await until(async () =>
      (
        await db.query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
        )
      ).startsWith("1"),
    );
    first.write("COMMIT;");
    first.end();
    second.end();
    const [winner, loser] = await Promise.all([first.done, second.done]);
    assert.equal(winner.code, 0);
    assert.notEqual(loser.code, 0);
    assert.match(loser.errors, /REGISTRATION_CODE_UNAVAILABLE/);
    assert.equal(
      await db.query(
        "SELECT count(*) FROM public.clients WHERE institutional_code IS NOT NULL",
      ),
      "1",
    );
    assert.equal(
      await db.query("SELECT count(*) FROM public.pending_registrations"),
      "1",
    );
  },
);

test("setup_auth.sql refuses to run after 018", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await assert.rejects(
    db.exec(await readFile(setupUrl, "utf8")),
    /cannot run after migration 018/,
  );
  await db.exec("ROLLBACK");
  const source = (
    await one(
      db,
      "SELECT prosrc FROM pg_proc WHERE proname = 'create_auth_profile'",
    )
  ).prosrc;
  assert.match(source, /registration_domain_rule/);
});
