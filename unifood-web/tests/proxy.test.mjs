import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
// The installed Next 16.3.8 implementation still exports this matcher helper
// under its former name, despite its local guide saying doesProxyMatch.
const {
  unstable_doesMiddlewareMatch: unstable_doesProxyMatch,
} = require("next/experimental/testing/server");
function load(file, mocks, cache = new Map()) {
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
        return load(name.slice(2) + ".ts", mocks, cache);
      if (name.startsWith("."))
        return load(
          path.resolve(path.dirname(resolved), name) + ".ts",
          mocks,
          cache,
        );
      return require(name);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
const fixtureConfig = {
  url: "https://configuration-test.invalid",
  key: "opaque-test-key",
};

test("proxy matcher covers public session readers and protected routes without guarding role admission", () => {
  const { config } = load("proxy.ts", {
    "@supabase/ssr": {},
    "@/config/server": { serverAuthConfig: () => fixtureConfig },
  });
  for (const url of [
    "/login",
    "/panel/login",
    "/registro",
    "/recuperar-contrasena?entrypoint=panel",
    "/cuenta",
    "/worker",
    "/admin",
    "/super-admin",
    "/api/orders",
  ])
    assert.equal(
      unstable_doesProxyMatch({ config, nextConfig: {}, url }),
      true,
      url,
    );
  for (const url of [
    "/",
    "/api/auth/login",
    "/unifood-logo.png",
    "/_next/static/test.js",
  ])
    assert.equal(
      unstable_doesProxyMatch({ config, nextConfig: {}, url }),
      false,
      url,
    );
});
test("proxy refreshes request and response cookies with existing session options, without role queries", async () => {
  const { NextRequest } = require("next/server");
  for (const remember of [true, false]) {
    let userReads = 0;
    const route = load("proxy.ts", {
      "@/config/server": { serverAuthConfig: () => fixtureConfig },
      "@supabase/ssr": {
        createServerClient: (_url, _key, options) => ({
          auth: {
            getUser: async () => {
              userReads++;
              options.cookies.setAll([
                {
                  name: "fixture-session",
                  value: "refreshed",
                  options: { maxAge: 3600 },
                },
              ]);
              return { data: { user: { user_metadata: { role: "ADMIN" } } } };
            },
          },
        }),
      },
    });
    const request = new NextRequest("http://localhost:3100/panel/login", {
      headers: { cookie: `unifood-remember=${remember ? "1" : "0"}` },
    });
    const response = await route.proxy(request);
    assert.equal(userReads, 1);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(request.cookies.get("fixture-session").value, "refreshed");
    const cookie = response.cookies.get("fixture-session");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
    assert.equal(cookie.maxAge, remember ? 2592000 : undefined);
  }
});
test("server auth client reports precisely SDK cookie writes so admission cleanup needs no cookie-name heuristics", async () => {
  let options;
  const writes = [],
    names = [];
  const client = load("features/auth/server/client.ts", {
    "@/config/server": { serverAuthConfig: () => fixtureConfig },
    "next/headers": {
      cookies: async () => ({
        get: () => undefined,
        getAll: () => [{ name: "unrelated", value: "keep" }],
        set: (...args) => writes.push(args),
      }),
    },
    "@supabase/ssr": {
      createServerClient: (_url, _key, settings) => {
        options = settings;
        return {};
      },
    },
  });
  await client.authClient(false, (values) => names.push(...values));
  options.cookies.setAll([
    { name: "opaque-sdk-cookie.0", value: "fixture", options: {} },
    { name: "opaque-sdk-cookie.1", value: "", options: { maxAge: 0 } },
  ]);
  assert.deepEqual(names, ["opaque-sdk-cookie.0", "opaque-sdk-cookie.1"]);
  assert.equal(writes[0][2].httpOnly, true);
  assert.equal(writes[1][2].maxAge, 0);
  assert.deepEqual(options.cookies.getAll(), [
    { name: "unrelated", value: "keep" },
  ]);
});
