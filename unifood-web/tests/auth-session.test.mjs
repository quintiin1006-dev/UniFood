import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
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

function session(profile) {
  let tokenReads = 0;
  const auth = load("features/auth/server/session.ts", {
    react: { cache: (fn) => fn },
    "next/navigation": {
      redirect: (location) => {
        throw new Error(location);
      },
    },
    "./config": { authConfig: () => ({}) },
    "./client": {
      authClient: async () => ({
        auth: {
          getUser: async () => ({
            data: {
              user: { id: "verified-user", email_confirmed_at: "2026-01-01" },
            },
            error: null,
          }),
          getSession: async () => {
            tokenReads++;
            return { data: { session: { access_token: "server-only-token" } } };
          },
        },
        rpc: async (name) => {
          assert.equal(name, "current_auth_profile");
          return { data: profile, error: null };
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
    assert.equal(fixture.tokenReads(), 0);
  }
});
