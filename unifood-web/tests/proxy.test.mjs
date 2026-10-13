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
    "/cuenta/perfil",
    "/cuenta/pedidos/example",
    "/worker",
    "/admin",
    "/super-admin",
    "/api/orders",
    "/api/me/orders/00000000-0000-0000-0000-000000000001/cancel",
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

test("rejected refresh deletes all project chunks/PKCE cookies on the contextual redirect or API response", async () => {
  const { NextRequest } = require("next/server");
  const key = "sb-configuration-test-auth-token";
  for (const [path, status, login] of [
    ["/worker", 307, "/panel/login"],
    ["/cuenta", 307, "/login"],
    ["/panel/login", 200, null],
    ["/login", 200, null],
    ["/api/orders", 401, null],
    ["/api/me/orders/id/cancel", 401, null],
  ]) {
    const route = load("proxy.ts", {
      "@/config/server": { serverAuthConfig: () => fixtureConfig },
      "@supabase/ssr": {
        createServerClient: (_url, _key, options) => ({
          auth: {
            getUser: async () => {
              // Reproduce two SDK callbacks and a partially deleted request, before redirect.
              options.cookies.setAll([
                { name: `${key}.0`, value: "", options: { maxAge: 0 } },
              ]);
              options.cookies.setAll([
                { name: `${key}-user`, value: "", options: { maxAge: 0 } },
              ]);
              return {
                data: { user: null },
                error: { code: "refresh_token_not_found" },
              };
            },
          },
        }),
      },
    });
    const names = [
      `${key}.0`,
      `${key}.1`,
      `${key}-user`,
      `${key}-code-verifier`,
      `${key}-flow-abcdefgh-code-verifier`,
      "unifood-remember",
    ];
    const request = new NextRequest(`http://localhost:3100${path}`, {
      headers: {
        cookie: [
          ...names.map((name) => `${name}=1`),
          "sb-other-auth-token=keep",
          "theme=keep",
        ].join("; "),
      },
    });
    const response = await route.proxy(request);
    assert.equal(response.status, status);
    assert.equal(
      response.headers.get("location"),
      login ? `http://localhost:3100${login}` : null,
    );
    for (const name of names) {
      assert.equal(response.cookies.get(name)?.maxAge, 0, name);
      assert.equal(request.cookies.get(name), undefined, name);
    }
    assert.equal(response.cookies.get("sb-other-auth-token"), undefined);
    assert.equal(request.cookies.get("sb-other-auth-token").value, "keep");
    assert.equal(
      response.headers.get("cache-control"),
      path.startsWith("/api/") ? "no-store" : "private, no-store",
    );
  }
});

test("expired or revoked refresh tokens clear all relevant cookies and redirect contextually", async () => {
  const { NextRequest } = require("next/server");
  const key = "sb-configuration-test-auth-token";
  for (const code of [
    "refresh_token_expired",
    "refresh_token_revoked",
    "session_expired",
  ]) {
    const route = load("proxy.ts", {
      "@/config/server": { serverAuthConfig: () => fixtureConfig },
      "@supabase/ssr": {
        createServerClient: () => ({
          auth: {
            getUser: async () => ({
              data: { user: null },
              error: { status: 400, code },
            }),
          },
        }),
      },
    });
    for (const [path, login] of [
      ["/worker", "/panel/login"],
      ["/cuenta", "/login"],
    ]) {
      const names = [
        `${key}.0`,
        `${key}.1`,
        `${key}-code-verifier`,
        "unifood-remember",
      ];
      const response = await route.proxy(
        new NextRequest(`http://localhost:3100${path}`, {
          headers: {
            cookie: names.map((name) => `${name}=expired`).join("; "),
          },
        }),
      );
      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        `http://localhost:3100${login}`,
      );
      assert.ok(
        names.every((name) => response.cookies.get(name)?.maxAge === 0),
      );
    }
  }
});

test("multiple refresh callbacks retain all response writes", async () => {
  const { NextRequest } = require("next/server");
  const route = load("proxy.ts", {
    "@/config/server": { serverAuthConfig: () => fixtureConfig },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              { name: "first", value: "value", options: {} },
            ]);
            options.cookies.setAll([
              { name: "second", value: "value", options: {} },
            ]);
            return { data: { user: { id: "verified" } }, error: null };
          },
        },
      }),
    },
  });
  const response = await route.proxy(
    new NextRequest("http://localhost:3100/worker"),
  );
  assert.equal(response.cookies.get("first").value, "value");
  assert.equal(response.cookies.get("second").value, "value");
});

for (const [label, failure, thrown] of [
  [
    "AuthRetryableFetchError 503",
    new (require("@supabase/auth-js").AuthRetryableFetchError)(
      "PRIVATE_PROVIDER_DETAIL",
      503,
    ),
    false,
  ],
  [
    "502 provider response",
    { status: 502, message: "PRIVATE_PROVIDER_DETAIL" },
    false,
  ],
  [
    "timeout",
    new DOMException("PRIVATE_PROVIDER_DETAIL", "TimeoutError"),
    true,
  ],
  ["network failure", new TypeError("PRIVATE_PROVIDER_DETAIL"), true],
  [
    "unknown provider failure",
    {
      status: 400,
      code: "unknown_failure",
      message: "PRIVATE_PROVIDER_DETAIL",
    },
    false,
  ],
]) {
  test(`${label} preserves cookies, blocks access safely and recovers without login loops`, async () => {
    const { NextRequest } = require("next/server");
    const key = "sb-configuration-test-auth-token";
    const cookies = `${key}.0=original; ${key}.1=chunk; ${key}-code-verifier=pkce; unifood-remember=1; theme=keep`;
    for (const path of [
      "/worker",
      "/cuenta",
      "/panel/login",
      "/login",
      "/api/orders",
      "/api/me/orders/id/cancel",
    ]) {
      let unavailable = true;
      const route = load("proxy.ts", {
        "@/config/server": { serverAuthConfig: () => fixtureConfig },
        "@supabase/ssr": {
          createServerClient: (_url, _key, options) => ({
            auth: {
              getUser: async () => {
                if (!unavailable)
                  return { data: { user: { id: "verified" } }, error: null };
                // Even an SDK deletion callback must not invalidate the browser on a transient failure.
                options.cookies.setAll([
                  { name: `${key}.0`, value: "", options: { maxAge: 0 } },
                ]);
                if (thrown) throw failure;
                return { data: { user: null }, error: failure };
              },
            },
          }),
        },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await route.proxy(
          new NextRequest(`http://localhost:3100${path}`, {
            headers: { cookie: cookies },
          }),
        );
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal(response.headers.get("retry-after"), "5");
        assert.equal(
          response.headers.get("cache-control"),
          path.startsWith("/api/") ? "no-store" : "private, no-store",
        );
        const body = await response.text();
        assert.ok(!body.includes("PRIVATE_PROVIDER_DETAIL"));
        if (path.startsWith("/api/"))
          assert.equal(JSON.parse(body).code, "AUTH_TEMPORARILY_UNAVAILABLE");
        else assert.ok(body.includes("Volver a intentar"));
      }
      unavailable = false;
      const response = await route.proxy(
        new NextRequest(`http://localhost:3100${path}`, {
          headers: { cookie: cookies },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });
}

test("explicit route-handler cleanup erases existing chunks and SDK writes even without provider sign-out", async () => {
  const key = "sb-configuration-test-auth-token",
    writes = [];
  const client = load("features/auth/server/client.ts", {
    "@/config/server": { serverAuthConfig: () => fixtureConfig },
    "@supabase/ssr": {},
    "next/headers": {
      cookies: async () => ({
        getAll: () => [{ name: `${key}.1` }, { name: "unrelated" }],
        set: (...args) => writes.push(args),
      }),
    },
  });
  await client.clearAuthCookies([`${key}.0`]);
  assert.deepEqual(
    new Set(writes.map(([name]) => name)),
    new Set([`${key}.0`, `${key}.1`, "unifood-remember"]),
  );
  assert.ok(
    writes.every(
      ([, value, options]) =>
        value === "" && options.maxAge === 0 && options.httpOnly,
    ),
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
