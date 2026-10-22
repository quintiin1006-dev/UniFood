import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminCatalogFixture } from "./helpers/admin-catalog-fixture.mjs";
import { adminProfileFixture } from "./helpers/admin-profile-fixture.mjs";

const load = availabilityLoader();
const { parseCatalogCommand, validateCatalogForm } = load(
  "features/admin-catalog/commands.ts",
);
const { validCatalogVersion } = load("features/admin-catalog/contracts.ts");
const form = {
  name: " Producto ",
  description: null,
  price: "18500.25",
  category: "CORRIENTE",
};
test("commercial commands allow only published fields, exact money and lossless revision preconditions", () => {
  assert.deepEqual(parseCatalogCommand(form, "create"), {
    ...form,
    name: "Producto",
  });
  const { description: ignoredDescription, ...partial } = form;
  assert.equal(ignoredDescription, null);
  assert.equal(
    parseCatalogCommand({ ...partial, expectedVersion: "0" }, "edit"),
    null,
  );
  for (const patch of [
    { cafeteriaId: "x" },
    { stock: 1 },
    { imageUrl: null },
    { active: false },
    { version: "1" },
    { price: 1 },
    { price: "1.001" },
    { price: "0.00" },
    { category: "DRINK" },
    { description: [] },
    { name: " " },
    { name: String.fromCharCode(0) },
    { name: String.fromCharCode(0xd800) },
    { name: "x".repeat(151) },
    { description: "x".repeat(2001) },
  ])
    assert.equal(
      parseCatalogCommand({ ...form, ...patch }, "create"),
      null,
      JSON.stringify(patch),
    );
  for (const version of ["0", "9007199254740993", "9223372036854775807"])
    assert.ok(
      parseCatalogCommand({ ...form, expectedVersion: version }, "edit"),
    );
  for (const version of [
    -1,
    0,
    1,
    "-1",
    "01",
    "1.0",
    "9223372036854775808",
    "",
  ])
    assert.equal(validCatalogVersion(version), false);
  assert.deepEqual(
    parseCatalogCommand({ active: false, expectedVersion: "1" }, "status"),
    { active: false, expectedVersion: "1" },
  );
  for (const patch of [
    { active: "true" },
    { active: null },
    { expectedVersion: 1 },
    { other: true },
  ])
    assert.equal(
      parseCatalogCommand(
        { active: true, expectedVersion: "0", ...patch },
        "status",
      ),
      null,
    );
  assert.deepEqual(
    validateCatalogForm({
      ...form,
      name: "🍚".repeat(150),
      description: "🍚".repeat(2000),
    }),
    {},
  );
});
test("migration 016 independently upgrades legacy rows, preserves integrity/grants and invalidates all old versions", async () => {
  const db = await createAuthDatabase({ throughMigration: "015" });
  try {
    await db.exec(
      "INSERT INTO institutions(id,name,email_domain,brand_name) VALUES ('00000000-0000-0000-0000-000000000001','Test','test.invalid','Test'); INSERT INTO sites(id,name,city,institution_id) VALUES ('00000000-0000-0000-0000-000000000002','Site','Test','00000000-0000-0000-0000-000000000001'); INSERT INTO cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','Cafe',false,'07:00','08:00'); INSERT INTO lunches(id,cafeteria_id,name,category,price,description,stock,is_active) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','Legacy','CORRIENTE',18500.25,'Legacy description',8,false)",
    );
    const indexes = (
      await db.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname",
      )
    ).rows;
    const constraints = (
      await db.query(
        "SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname",
      )
    ).rows;
    const migration = await readFile(
      new URL(
        "../../unifood-backend/supabase/migrations/016_catalog_revision.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    const p = (await db.query("SELECT * FROM lunches")).rows[0];
    assert.equal(String(p.version), "0");
    assert.equal(p.stock, 8);
    assert.equal(p.is_active, false);
    assert.equal(p.description, "Legacy description");
    assert.equal(Number(p.price), 18500.25);
    assert.deepEqual(
      (
        await db.query(
          "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname",
        )
      ).rows,
      indexes,
    );
    const after = (
      await db.query(
        "SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname",
      )
    ).rows;
    assert.deepEqual(
      after.filter((c) => !c.conname.startsWith("lunches_version_")),
      constraints,
    );
    await db.exec("UPDATE lunches SET stock=9,version=900;");
    assert.equal(
      String((await db.query("SELECT version FROM lunches")).rows[0].version),
      "1",
    );
    assert.equal(
      (
        await db.query(
          "UPDATE lunches SET name='stale' WHERE version=0 RETURNING id",
        )
      ).rows.length,
      0,
    );
    await db.exec("BEGIN;UPDATE lunches SET name='rolled back';ROLLBACK;");
    assert.equal(
      String((await db.query("SELECT version FROM lunches")).rows[0].version),
      "1",
    );
    for (const actor of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query(
            "SELECT has_function_privilege($1,'public.advance_lunch_version()','EXECUTE') AS allowed",
            [actor],
          )
        ).rows[0].allowed,
        false,
      );
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
      ])
        assert.equal(
          (
            await db.query(
              "SELECT has_table_privilege($1,'public.lunches',$2) AS allowed",
              [actor, privilege],
            )
          ).rows[0].allowed,
          false,
        );
      for (const privilege of ["SELECT", "INSERT", "UPDATE"])
        assert.equal(
          (
            await db.query(
              "SELECT has_column_privilege($1,'public.lunches','version',$2) AS allowed",
              [actor, privilege],
            )
          ).rows[0].allowed,
          false,
        );
    }
    await assert.rejects(db.exec(migration));
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.query("SELECT count(*) FROM lunches")).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test("an obsolete GET cannot replace a confirmed write, including a precision-sensitive version", async () => {
  const { AdminCatalogStore } = load("features/admin-catalog/state.ts");
  const pending = defer();
  const store = new AdminCatalogStore({ get: () => pending.promise });
  const old = store.refresh();
  const p = {
    ...adminCatalogFixture().products[0],
    name: "Confirmed",
    version: "9007199254740993",
  };
  store.applyConfirmed(p);
  pending.resolve(adminCatalogFixture());
  await old;
  assert.equal(store.getSnapshot().data.products[0].name, "Confirmed");
  store.applyConfirmed({ ...p, name: "Older", version: "9007199254740992" });
  assert.equal(store.getSnapshot().data.products[0].name, "Confirmed");
});
test("a late mutation acknowledgement cannot restore data after definitive denial, including a later recovery", async () => {
  const { AdminCatalogStore } = load("features/admin-catalog/state.ts");
  const { AdminCatalogError } = load("features/admin-catalog/errors.ts");
  let denied = false;
  const store = new AdminCatalogStore({
    get: async () => {
      if (denied) throw new AdminCatalogError(403);
      return adminCatalogFixture();
    },
  });
  await store.refresh();
  const admission = store.invalidateReads();
  denied = true;
  await store.refresh();
  const acknowledgement = {
    ...adminCatalogFixture().products[0],
    name: "Obsolete acknowledgement",
    version: "1",
  };
  store.applyConfirmed(acknowledgement, admission);
  assert.equal(store.getSnapshot().data, null);
  assert.equal(store.getSnapshot().error.status, 403);
  denied = false;
  await store.refresh();
  store.applyConfirmed(acknowledgement, admission);
  assert.equal(
    store.getSnapshot().data.products[0].name,
    adminCatalogFixture().products[0].name,
  );
});

test("profile refresh retains draft host but blocks mutations until verified; definitive denial removes context", async () => {
  const { AdminProfileStore } = load("features/admin-profile/state.ts");
  const { AdminProfileError } = load("features/admin-profile/errors.ts");
  let next = Promise.resolve(adminProfileFixture());
  const store = new AdminProfileStore({ get: () => next });
  await store.refresh();
  const pending = defer();
  next = pending.promise;
  const refreshing = store.refresh();
  assert.equal(store.getSnapshot().loading, true);
  assert.ok(store.getSnapshot().data);
  pending.reject(new AdminProfileError(503));
  await refreshing;
  assert.ok(store.getSnapshot().data);
  assert.equal(store.getSnapshot().error.status, 503);
  next = Promise.reject(new AdminProfileError(403));
  await store.refresh();
  assert.equal(store.getSnapshot().data, null);
});
function bff(
  fetchMock,
  auth = { id: "verified", accessToken: "verified-token" },
  profile = { id: "verified", active: true, roles: ["ADMIN"] },
) {
  return availabilityLoader({
    fetchMock,
    mocks: {
      "@/features/auth/server/identity": {
        getVerifiedAuthIdentity: async () => auth,
      },
      "@/features/auth/server/client": {
        authClient: async () => ({
          rpc: async () => ({ data: profile, error: null }),
        }),
      },
    },
  });
}
const request = (body = form, origin = "http://browser") =>
  new Request("http://browser/api/admin/catalog", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
test("BFF creation and edits preserve 201/200, verified bearer, fixed tenant-free paths, no-store and sanitized product", async () => {
  for (const kind of ["create", "edit", "status"]) {
    const p = adminCatalogFixture().products[0];
    let calls = 0;
    const modules = bff(async (url, options) => {
      calls++;
      assert.equal(options.method, kind === "create" ? "POST" : "PATCH");
      assert.equal(options.headers.authorization, "Bearer verified-token");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal);
      assert.equal(
        url,
        "http://backend.test:8080/api/admin/catalog" +
          (kind === "create"
            ? ""
            : "/" + p.id + (kind === "status" ? "/status" : "")),
      );
      assert.equal(JSON.parse(options.body).cafeteriaId, undefined);
      return Response.json(
        { ...p, private: "SECRET" },
        {
          status: kind === "create" ? 201 : 200,
          headers: { "set-cookie": "SECRET" },
        },
      );
    });
    const forward = modules(
      "features/admin-catalog/server/forward.ts",
    ).forwardAdminCatalogMutation;
    const response = await forward(
      request(
        kind === "status"
          ? { active: false, expectedVersion: "0" }
          : { ...form, ...(kind === "edit" ? { expectedVersion: "0" } : {}) },
      ),
      kind,
      p.id,
    );
    assert.equal(response.status, kind === "create" ? 201 : 200);
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), p);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  }
});
test("BFF rejects cross-origin, invalid bodies, tenant selectors and unauthenticated callers before upstream writes", async () => {
  const modules = bff(() => assert.fail("No upstream"));
  const forward = modules(
    "features/admin-catalog/server/forward.ts",
  ).forwardAdminCatalogMutation;
  assert.equal(
    (await forward(request(form, "http://evil"), "create")).status,
    403,
  );
  for (const body of [
    { ...form, cafeteriaId: "x" },
    { ...form, description: "🍚".repeat(6000) },
    null,
  ])
    assert.equal((await forward(request(body), "create")).status, 400);
  assert.equal(
    (
      await forward(
        request({ ...form, expectedVersion: "0" }),
        "edit",
        "not-uuid",
      )
    ).status,
    400,
  );
  const noAuth = bff(
    () => assert.fail("No upstream"),
    null,
  )("features/admin-catalog/server/forward.ts").forwardAdminCatalogMutation;
  assert.equal((await noAuth(request(), "create")).status, 401);
});
test("BFF bounds streamed bytes without relying on Content-Length and rejects malformed JSON", async () => {
  const forward = bff(() => assert.fail("No upstream"))(
    "features/admin-catalog/server/forward.ts",
  ).forwardAdminCatalogMutation;
  for (const raw of ["{", " ".repeat(18000)])
    assert.equal(
      (
        await forward(
          new Request("http://browser/api/admin/catalog", {
            method: "POST",
            headers: {
              origin: "http://browser",
              "content-type": "application/json",
            },
            body: raw,
          }),
          "create",
        )
      ).status,
      400,
    );
});
test("BFF preserves public conflicts, not-found and inactive contracts without exposing upstream messages", async () => {
  for (const [status, code] of [
    [400, "ADMIN_CATALOG_INVALID_REQUEST"],
    [403, "ADMIN_CATALOG_CAFETERIA_INACTIVE"],
    [404, "ADMIN_CATALOG_PRODUCT_NOT_FOUND"],
    [409, "ADMIN_CATALOG_STALE_VERSION"],
    [409, "ADMIN_CATALOG_DUPLICATE_NAME"],
    [500, "ADMIN_CATALOG_INTERNAL_ERROR"],
    [503, "ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE"],
  ]) {
    const forward = bff(async () =>
      Response.json(
        { code, message: "PRIVATE_SQL", credentials: "SECRET" },
        { status, headers: { "retry-after": "9", "set-cookie": "SECRET" } },
      ),
    )("features/admin-catalog/server/forward.ts").forwardAdminCatalogMutation;
    const response = await forward(request(), "create");
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE|SECRET/);
    assert.equal(
      response.headers.get("retry-after"),
      status === 503 ? "9" : null,
    );
  }
});
test("browser uncertain POST is issued exactly once with no optimistic success or retry", async () => {
  let calls = 0;
  const modules = availabilityLoader({
    fetchMock: async () => {
      calls++;
      throw new Error("Network result unknown");
    },
  });
  const api = modules("features/admin-catalog/api.ts").adminCatalogApi;
  await assert.rejects(
    api.mutate({ kind: "create", form }),
    (e) => e.status === 503,
  );
  assert.equal(calls, 1);
});
