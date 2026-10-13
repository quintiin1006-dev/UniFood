import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
const { unstable_rethrow } = createRequire(import.meta.url)("next/navigation");
function load(file, mocks = {}, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => {
      if (name === "server-only") return {};
      if (name in mocks) return mocks[name];
      if (name.startsWith("@/"))
        return load(`${name.slice(2)}.ts`, mocks, cache);
      if (name.startsWith("."))
        return load(
          path.resolve(path.dirname(resolved), `${name}.ts`),
          mocks,
          cache,
        );
      throw new Error(`Unexpected import: ${name}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

function session(
  profile,
  {
    user = { id: "verified-user", email_confirmed_at: "2026-01-01" },
    userError = null,
    profileError = null,
    authSession = { access_token: "server-only-token" },
    sessionError = null,
    userThrow = null,
  } = {},
) {
  let tokenReads = 0;
  const auth = load("features/auth/server/session.ts", {
    react: { cache: (fn) => fn },
    "next/navigation": {
      unstable_rethrow,
      redirect: (location) => {
        throw new Error(location);
      },
    },
    "./config": { authConfig: () => ({}) },
    "./client": {
      authClient: async () => ({
        auth: {
          getUser: async () => {
            if (userThrow) throw userThrow;
            return {
              data: {
                user,
              },
              error: userError,
            };
          },
          getSession: async () => {
            tokenReads++;
            return { data: { session: authSession }, error: sessionError };
          },
        },
        rpc: async (name) => {
          assert.equal(name, "current_auth_profile");
          return { data: profile, error: profileError };
        },
      }),
    },
  });
  return { auth, tokenReads: () => tokenReads };
}
test("verified session loads each single current business role", async () => {
  for (const role of ["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"]) {
    const profile = { id: "verified-user", active: true, roles: [role] };
    const fixture = session(profile);
    assert.deepEqual(await fixture.auth.getAuth(), {
      profile,
      accessToken: "server-only-token",
    });
    assert.equal(fixture.tokenReads(), 1);
    assert.equal((await fixture.auth.requireAuth("panel")).profile, profile);
  }
});

test("definitive identity errors, unconfirmed email and missing sessions deny access", async () => {
  const profile = { id: "verified-user", active: true, roles: ["WORKER"] };
  for (const [options, tokenReads] of [
    [{ user: null }, 0],
    [{ userError: { status: 401 } }, 0],
    [{ user: { id: "verified-user", email_confirmed_at: null } }, 0],
    [{ authSession: null }, 1],
  ]) {
    const fixture = session(profile, options);
    assert.equal(await fixture.auth.getAuth(), null);
    assert.equal(fixture.tokenReads(), tokenReads);
    await assert.rejects(
      fixture.auth.requireAuth("panel"),
      /^Error: \/panel\/login$/,
    );
  }
});

test("framework dynamic-rendering signals are rethrown instead of becoming auth outages", async () => {
  const control = Object.assign(new Error("Framework rendering signal"), {
    digest: "DYNAMIC_SERVER_USAGE",
  });
  const fixture = session(
    { active: true, roles: ["CLIENT"] },
    { userThrow: control },
  );
  await assert.rejects(fixture.auth.getAuth(), (error) => error === control);
  assert.equal(fixture.tokenReads(), 0);
});

test("temporary failures during the server verification never become anonymous login redirects", async () => {
  const profile = { id: "verified-user", active: true, roles: ["CLIENT"] };
  for (const [options, reads] of [
    [{ userError: { name: "AuthRetryableFetchError", status: 503 } }, 0],
    [{ userThrow: new TypeError("PRIVATE_FETCH_DETAIL") }, 0],
    [
      { userThrow: new DOMException("PRIVATE_TIMEOUT_DETAIL", "TimeoutError") },
      0,
    ],
    [{ profileError: { status: 503, message: "PRIVATE_RPC_DETAIL" } }, 0],
    [{ sessionError: { name: "AuthRetryableFetchError", status: 0 } }, 1],
  ]) {
    const fixture = session(profile, options);
    const unavailable = (error) =>
      error.code === "AUTH_TEMPORARILY_UNAVAILABLE" &&
      !error.message.includes("PRIVATE") &&
      !error.message.includes("/login");
    await assert.rejects(fixture.auth.getAuth(), unavailable);
    assert.equal(fixture.tokenReads(), reads);
    await assert.rejects(fixture.auth.requireAuth("client"), unavailable);
    await assert.rejects(fixture.auth.requireAuth("panel"), unavailable);
  }
});
test("invalid role profiles never load an access token and redirect protected pages to login", async () => {
  for (const profile of [
    null,
    { active: false, roles: ["CLIENT"] },
    ...[
      [],
      ["UNKNOWN"],
      ["CLIENT", "CLIENT"],
      ["CLIENT", "WORKER"],
      ["WORKER", "ADMIN"],
      ["ADMIN", "SUPER_ADMIN"],
      null,
      "CLIENT",
    ].map((roles) => ({ active: true, roles })),
  ]) {
    const fixture = session(profile);
    assert.equal(await fixture.auth.getAuth(), null);
    await assert.rejects(fixture.auth.requireAuth(), /\/login/);
    await assert.rejects(fixture.auth.requireAuth("panel"), /\/panel\/login/);
    assert.equal(fixture.tokenReads(), 0);
  }
});
