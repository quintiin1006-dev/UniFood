import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./helpers/native-auth-database.mjs";

const student = "1234567";
const migrationUrl = new URL(
  "../../unifood-backend/supabase/migrations/018_secure_registration.sql",
  import.meta.url,
);
const setupUrl = new URL(
  "../../unifood-backend/supabase/setup_auth.sql",
  import.meta.url,
);

function metadata(overrides = {}) {
  return {
    full_name: "Ana Torres",
    code: student,
    privacy_accepted: "true",
    ...overrides,
  };
}

// A public signup: app metadata is empty because the browser cannot write it.
async function signup(db, email, meta = metadata(), app = {}) {
  return (
    await db.query(
      `INSERT INTO auth.users(email, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, $3) RETURNING id`,
      [email, JSON.stringify(meta), JSON.stringify(app)],
    )
  ).rows[0].id;
}

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail("Timed out waiting for PostgreSQL lock evidence");
}

const rejected = (error) => error.code === "23514";
const count = async (db, table) =>
  (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test("signup domain rule accepts institutional emails only", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const accepted = [
    ["nombre@ustavillavo.edu.co", student, "STUDENT"],
    ["NOMBRE2@USTAVILLAVO.EDU.CO", "7654321", "STUDENT"],
    ["profe@ustavillavicencio.edu.co", null, "STAFF"],
  ];
  for (const [email, code, type] of accepted) {
    const id = await signup(db, email, metadata({ code }));
    const row = (
      await db.query(
        `SELECT u.email, u.is_active, c.client_type, r.name
         FROM public.users u
         JOIN public.clients c ON c.user_id = u.id
         JOIN public.user_roles ur ON ur.user_id = u.id
         JOIN public.roles r ON r.id = ur.role_id
         WHERE u.id = $1`,
        [id],
      )
    ).rows[0];
    assert.deepEqual(row, {
      email: email.toLowerCase(),
      is_active: false,
      client_type: type,
      name: "CLIENT",
    });
  }

  const users = await count(db, "public.users");
  const denied = [
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
    "nombre@gmail.com",
    "nombre",
    "",
  ];
  for (const email of denied)
    await assert.rejects(signup(db, email), rejected, email);
  assert.equal(await count(db, "public.users"), users);
});

test("a signup without registration fields never creates a profile", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await assert.rejects(signup(db, "nombre@gmail.com", {}), rejected);
  // The old flow trusted this browser field.
  await assert.rejects(
    signup(db, "nombre@gmail.com", {
      ...metadata(),
      registration_type: "student",
    }),
    rejected,
  );
  // Only an explicit true opens the Admin API path.
  await assert.rejects(
    signup(db, "nombre@gmail.com", metadata(), {
      unifood_provisioned: false,
    }),
    rejected,
  );
  assert.equal(await count(db, "public.users"), 0);
});

test("student code is mandatory, numeric and exactly 7 digits", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const email = "ana@ustavillavo.edu.co";
  for (const code of [null, "", "123456", "12345678", "12345a7", "123 567"])
    await assert.rejects(
      signup(db, email, metadata({ code })),
      rejected,
      String(code),
    );
  const id = await signup(db, email, metadata({ code: "0012345" }));
  const row = (
    await db.query(
      "SELECT institutional_code FROM public.clients WHERE user_id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(row.institutional_code, "0012345");
});

test("staff code is optional, numeric and between 5 and 12 digits", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  let sequence = 0;
  const email = () => `profe${++sequence}@ustavillavicencio.edu.co`;
  for (const code of ["1234", "1234567890123", "12a45"])
    await assert.rejects(
      signup(db, email(), metadata({ code })),
      rejected,
      code,
    );
  for (const code of [null, "", "12345", "123456789012"])
    await signup(db, email(), metadata({ code }));
  const codes = (
    await db.query(
      `SELECT institutional_code FROM public.clients
       ORDER BY institutional_code NULLS FIRST`,
    )
  ).rows.map((row) => row.institutional_code);
  assert.deepEqual(codes, [null, null, "12345", "123456789012"]);
});

test("codes are unique per institution, shared across client types", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await signup(db, "ana@ustavillavo.edu.co");
  await assert.rejects(
    signup(db, "eva@ustavillavo.edu.co"),
    (error) => error.code === "23505",
  );
  await assert.rejects(
    signup(db, "profe@ustavillavicencio.edu.co"),
    (error) => error.code === "23505",
  );
  assert.equal(await count(db, "public.users"), 1);
  await signup(db, "uno@ustavillavicencio.edu.co", metadata({ code: null }));
  await signup(db, "dos@ustavillavicencio.edu.co", metadata({ code: null }));

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
  await signup(db, "ana@otra.edu.co");
});

test("name and privacy acceptance are required; the date comes from the server", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const email = "ana@ustavillavo.edu.co";
  for (const overrides of [
    { full_name: "" },
    { full_name: "AB" },
    { privacy_accepted: "false" },
    { privacy_accepted: undefined },
  ])
    await assert.rejects(signup(db, email, metadata(overrides)), rejected);
  const id = await signup(
    db,
    email,
    metadata({ privacy_accepted_at: "2000-01-01T00:00:00Z" }),
  );
  const { year } = (
    await db.query(
      `SELECT extract(year FROM privacy_accepted_at)::int AS year
       FROM public.clients WHERE user_id = $1`,
      [id],
    )
  ).rows[0];
  assert.ok(year > 2000);
});

test("registration data leaves user metadata once the profile exists", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await signup(
    db,
    "ana@ustavillavo.edu.co",
    metadata({ registration_type: "student", keep: "yes" }),
  );
  const { raw_user_meta_data: meta } = (
    await db.query("SELECT raw_user_meta_data FROM auth.users WHERE id = $1", [
      id,
    ])
  ).rows[0];
  assert.deepEqual(meta, { keep: "yes" });
});

test("only app metadata marks a provisioned identity", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await assert.rejects(
    signup(db, "worker@cafeteria.example", {
      unifood_provisioned: "true",
    }),
    rejected,
  );
  const id = await signup(
    db,
    "worker@cafeteria.example",
    {},
    {
      unifood_provisioned: true,
    },
  );
  const row = (
    await db.query("SELECT is_active FROM public.users WHERE id = $1", [id])
  ).rows[0];
  assert.equal(row.is_active, false);
  assert.equal(await count(db, "public.clients"), 0);
});

test("the account activates once, when the email is confirmed", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const state = async (id) =>
    (
      await db.query(
        `SELECT is_active, email_confirmed_at IS NOT NULL AS confirmed
         FROM public.users WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const confirm = (id) =>
    db.query("UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1", [
      id,
    ]);

  const id = await signup(db, "ana@ustavillavo.edu.co");
  assert.deepEqual(await state(id), { is_active: false, confirmed: false });
  await confirm(id);
  assert.deepEqual(await state(id), { is_active: true, confirmed: true });

  // A later change of the timestamp must not undo an administrative deactivation.
  await db.query("UPDATE public.users SET is_active = false WHERE id = $1", [
    id,
  ]);
  await confirm(id);
  assert.deepEqual(await state(id), { is_active: false, confirmed: true });

  const provisioned = await signup(
    db,
    "worker@cafeteria.example",
    {},
    {
      unifood_provisioned: true,
    },
  );
  await confirm(provisioned);
  assert.deepEqual(await state(provisioned), {
    is_active: false,
    confirmed: true,
  });
});

test("self-registered accounts cannot change their email", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const id = await signup(db, "ana@ustavillavo.edu.co");
  await assert.rejects(
    db.query("UPDATE auth.users SET email = 'ana@gmail.com' WHERE id = $1", [
      id,
    ]),
    rejected,
  );
  await assert.rejects(
    db.query(
      "UPDATE auth.users SET email = 'ana@ustavillavicencio.edu.co' WHERE id = $1",
      [id],
    ),
    rejected,
  );
  await db.query(
    "UPDATE auth.users SET email = 'ANA@ustavillavo.edu.co' WHERE id = $1",
    [id],
  );
});

test("anon and authenticated reach public rules only", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  await signup(db, "ana@ustavillavo.edu.co");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      for (const email of [
        "ana@ustavillavo.edu.co",
        "ANA@USTAVILLAVO.EDU.CO",
      ]) {
        assert.equal(
          (
            await db.query("SELECT public.is_institutional_email($1) AS ok", [
              email,
            ])
          ).rows[0].ok,
          true,
        );
      }
      for (const email of [
        "ana@ustavillavo.edu.co.evil.com",
        "ana@evilustavillavo.edu.co",
        "ana+x@ustavillavo.edu.co",
        " ana@ustavillavo.edu.co",
      ]) {
        assert.equal(
          (
            await db.query("SELECT public.is_institutional_email($1) AS ok", [
              email,
            ])
          ).rows[0].ok,
          false,
          email,
        );
        assert.deepEqual(
          (await db.query("SELECT public.registration_rules($1) AS r", [email]))
            .rows[0].r,
          { allowed: false },
        );
      }
      assert.deepEqual(
        (
          await db.query("SELECT public.registration_rules($1) AS r", [
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

      for (const sql of [
        "SELECT * FROM public.institution_email_domains",
        "SELECT * FROM public.client_code_corrections",
        "SELECT institutional_code FROM public.clients",
        "INSERT INTO public.institution_email_domains VALUES ('x.co', gen_random_uuid(), 'STUDENT', false, 1, 1)",
        "SELECT public.registration_domain_rule('a@ustavillavo.edu.co')",
        "SELECT public.is_provisioned_identity('{}')",
        "SELECT public.valid_institutional_code('1', 1::smallint, 1::smallint)",
        "SELECT public.admin_set_client_code(gen_random_uuid(), NULL, 'motivo', gen_random_uuid())",
      ])
        await assert.rejects(
          db.query(sql),
          (error) => error.code === "42501",
          sql,
        );
    } finally {
      await db.exec("RESET ROLE");
    }
  }
});

test("SUPER_ADMIN releases and assigns a code with an audit record", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
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

  const wrong = await signup(db, "wrong@ustavillavo.edu.co");
  const clientId = async (user) =>
    (await db.query("SELECT id FROM public.clients WHERE user_id = $1", [user]))
      .rows[0].id;
  const wrongClient = await clientId(wrong);
  const set = (client, code, reason = "Reclamo con carné", who = actor) =>
    db.query("SELECT public.admin_set_client_code($1, $2, $3, $4)", [
      client,
      code,
      reason,
      who,
    ]);

  await assert.rejects(
    set(wrongClient, null, "Reclamo", wrong),
    (error) => error.code === "42501",
  );
  await assert.rejects(set(wrongClient, null, "x"), rejected);
  await assert.rejects(set(wrongClient, "123"), rejected);

  await set(wrongClient, null);
  assert.deepEqual(
    (
      await db.query(
        `SELECT institutional_code, code_review_required
         FROM public.clients WHERE id = $1`,
        [wrongClient],
      )
    ).rows[0],
    { institutional_code: null, code_review_required: true },
  );

  // The real owner can now use the released code.
  await signup(db, "owner@ustavillavo.edu.co");
  await assert.rejects(
    set(wrongClient, student),
    (error) => error.code === "23505",
  );
  await set(wrongClient, "7654321");
  assert.deepEqual(
    (
      await db.query(
        `SELECT institutional_code, code_review_required
         FROM public.clients WHERE id = $1`,
        [wrongClient],
      )
    ).rows[0],
    { institutional_code: "7654321", code_review_required: false },
  );
  assert.deepEqual(
    (
      await db.query(
        `SELECT previous_code, new_code, actor_id = $1 AS by_actor
         FROM public.client_code_corrections ORDER BY created_at, new_code NULLS FIRST`,
        [actor],
      )
    ).rows,
    [
      { previous_code: student, new_code: null, by_actor: true },
      { previous_code: null, new_code: "7654321", by_actor: true },
    ],
  );
});

test("upgrading from 017 keeps confirmed students working under review", async (t) => {
  const db = await createAuthDatabase({ throughMigration: "017" });
  t.after(() => db.close());
  const institution = (
    await db.query(
      "SELECT id FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co'",
    )
  ).rows[0].id;
  const legacy = async (email, document, confirmed) => {
    const id = (
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
    return { id, institution };
  };
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

  const client = async (id) =>
    (
      await db.query(
        `SELECT u.is_active, c.client_type, c.institutional_code,
                c.code_review_required, c.document,
                u.email_confirmed_at IS NOT NULL AS confirmed
         FROM public.users u JOIN public.clients c ON c.user_id = u.id
         WHERE u.id = $1`,
        [id],
      )
    ).rows[0];
  assert.deepEqual(await client(confirmed.id), {
    is_active: true,
    client_type: "STUDENT",
    institutional_code: null,
    code_review_required: true,
    document: "DOC-11111",
    confirmed: true,
  });
  assert.deepEqual(await client(pending.id), {
    is_active: false,
    client_type: "STUDENT",
    institutional_code: null,
    code_review_required: true,
    document: "DOC-22222",
    confirmed: false,
  });
  assert.deepEqual(await client(staff.id), {
    is_active: true,
    client_type: "STAFF",
    institutional_code: null,
    code_review_required: false,
    document: "DOC-33333",
    confirmed: true,
  });
  assert.equal(
    (
      await db.query("SELECT is_active FROM public.users WHERE id = $1", [
        worker,
      ])
    ).rows[0].is_active,
    false,
  );
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
    (
      await db.query(
        "SELECT to_regclass('public.institution_email_domains') AS t",
      )
    ).rows[0].t,
    null,
  );
});

test(
  "native PostgreSQL lets only one of two concurrent signups claim a code",
  { timeout: 120000 },
  async (t) => {
    const binaries = await postgresBinaries();
    if (!binaries) return t.skip("Native PostgreSQL is not installed");
    const db = await createNativeAuthDatabase(binaries);
    t.after(() => db.close());
    const insert = (name) => `
      INSERT INTO auth.users(email, raw_app_meta_data, raw_user_meta_data)
      VALUES ('${name}@ustavillavo.edu.co', '{}',
        '{"full_name":"Ana Torres","code":"${student}","privacy_accepted":"true"}');`;

    const first = db.session();
    const second = db.session();
    first.write(`BEGIN; ${insert("first")}`);
    await until(async () =>
      (
        await db.query(
          "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'",
        )
      ).startsWith("1"),
    );
    second.write(insert("second"));
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
    assert.match(loser.errors, /uq_clients_institution_code/);
    assert.equal(
      await db.query(
        "SELECT count(*) FROM public.clients WHERE institutional_code IS NOT NULL",
      ),
      "1",
    );
    assert.equal(await db.query("SELECT count(*) FROM auth.users"), "1");
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
    await db.query(
      "SELECT prosrc FROM pg_proc WHERE proname = 'create_auth_profile'",
    )
  ).rows[0].prosrc;
  assert.match(source, /registration_domain_rule/);
});
