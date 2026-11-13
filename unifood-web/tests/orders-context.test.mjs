import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function load(file, environment, fetchMock, mocks = {}, cache = new Map()) {
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
  new Function("require", "module", "exports", "process", "fetch", source)(
    (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      const dependency = name.startsWith("@/")
        ? path.resolve(`${name.slice(2)}.ts`)
        : path.resolve(path.dirname(resolved), `${name}.ts`);
      return load(dependency, environment, fetchMock, mocks, cache);
    },
    mod,
    mod.exports,
    { env: environment },
    fetchMock,
  );
  return mod.exports;
}

const firstCafeteria = "00000000-0000-0000-0000-000000000002";
const secondCafeteria = "00000000-0000-0000-0000-000000000003";
const environment = {
  API_URL: "http://backend.test:8080",
  NEXT_PUBLIC_CAFETERIA_ID: "client-selected-cafeteria",
};
function route(
  fetchMock,
  auth = {
    profile: { active: true, roles: ["WORKER"] },
    accessToken: "verified-session-token",
  },
) {
  return load("app/api/orders/[[...path]]/route.ts", environment, fetchMock, {
    "@/features/auth/server/session": { getAuth: async () => auth },
  });
}
const list = (handler, query = "") =>
  handler.GET(
    new Request(`http://localhost:3100/api/orders${query}`, {
      headers: { authorization: "Bearer forged-token" },
    }),
    { params: Promise.resolve({}) },
  );

test("worker BFF blocks temporary session verification without querying context or orders", async () => {
  const handler = load(
    "app/api/orders/[[...path]]/route.ts",
    environment,
    async () => {
      assert.fail("No token may be forwarded");
    },
    {
      "@/features/auth/server/session": {
        getAuth: async () => {
          throw Object.assign(new Error("PRIVATE_SESSION_DETAIL"), {
            code: "AUTH_TEMPORARILY_UNAVAILABLE",
          });
        },
      },
    },
  );
  const response = await list(handler);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  const body = await response.json();
  assert.equal(body.code, "AUTH_TEMPORARILY_UNAVAILABLE");
  assert.ok(!body.message.includes("PRIVATE"));
});

test("browser orders requests have no cafeteria parameter or environment fallback", async () => {
  for (const legacy of [undefined, "", "client-selected-cafeteria"]) {
    const calls = [];
    const api = load(
      "features/orders/api/orderApi.ts",
      { NEXT_PUBLIC_CAFETERIA_ID: legacy },
      async (url, options) => {
        calls.push([url, options]);
        return Response.json([]);
      },
    );
    assert.deepEqual(await api.getOrders(), []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/orders");
    assert.equal(calls[0][1].cache, "no-store");
    assert.equal(calls[0][1].headers, undefined);
  }
});

test("BFF lists with one Spring call using the session token and ignores client cafeteria overrides", async () => {
  const calls = [];
  const handler = route(async (url, options) => {
    calls.push([String(url), options]);
    return Response.json([{ cafeteriaId: firstCafeteria }], {
      headers: {
        "X-Business-Date": "2026-11-20",
        "X-Next-Business-Date-At": "2026-11-21T05:00:00Z",
        "Set-Cookie": "upstream=secret",
      },
    });
  });
  const response = await list(
    handler,
    `?cafeteriaId=${secondCafeteria}&cafeteriaId=forged&userId=forged`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ cafeteriaId: firstCafeteria }]);
  assert.equal(calls.length, 1);
  // No query string at all: the cafeteria is resolved by Spring from the database.
  assert.equal(calls[0][0], "http://backend.test:8080/api/worker/orders");
  const [, options] = calls[0];
  assert.equal(options.method, "GET");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(
    options.headers.get("authorization"),
    "Bearer verified-session-token",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-business-date"), "2026-11-20");
  assert.equal(
    response.headers.get("x-next-business-date-at"),
    "2026-11-21T05:00:00Z",
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("each listing is authorized again and a revoked worker is denied with the fixed message", async () => {
  let allowed = true;
  let calls = 0;
  const handler = route(async (url) => {
    calls++;
    assert.equal(String(url), "http://backend.test:8080/api/worker/orders");
    return allowed
      ? Response.json([])
      : Response.json(
          { code: "FORBIDDEN", message: "database-secret" },
          { status: 403 },
        );
  });
  assert.equal((await list(handler)).status, 200);
  assert.equal((await list(handler)).status, 200);
  allowed = false;
  const revoked = await list(handler);
  assert.equal(revoked.status, 403);
  const body = await revoked.json();
  assert.equal(body.message, "No se pudo resolver la cafetería de tu cuenta.");
  assert.ok(!JSON.stringify(body).includes("database-secret"));
  assert.equal(calls, 3);
});

test("denied, failed or malformed listings never leak upstream values", async () => {
  for (const [makeResponse, expectedStatus] of [
    ...[401, 403, 400, 404, 409, 500, 503].map((status) => [
      () => Response.json({ message: "provider-secret" }, { status }),
      [401, 403].includes(status) ? status : 502,
    ]),
    [() => new Response("provider-secret", { status: 200 }), 502],
    [
      () =>
        new Response("provider-secret", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      502,
    ],
    [
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://evil.test/provider-secret" },
        }),
      502,
    ],
    [
      () => {
        throw new Error("provider-secret");
      },
      502,
    ],
  ]) {
    let calls = 0;
    const handler = route(async (url) => {
      calls++;
      assert.ok(String(url).endsWith("/api/worker/orders"));
      return makeResponse();
    });
    const response = await list(handler);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("location"), null);
    assert.ok(!(await response.text()).includes("provider-secret"));
    assert.equal(calls, 1);
  }
});

test("a non-worker session is denied before any Spring call", async () => {
  for (const roles of [["CLIENT"], ["ADMIN"], ["SUPER_ADMIN"]]) {
    const handler = route(
      async () => assert.fail("No Spring call for a non-worker"),
      {
        profile: { active: true, roles },
        accessToken: "verified-session-token",
      },
    );
    assert.equal((await list(handler)).status, 403);
  }
  const anonymous = route(async () => assert.fail("No Spring call"), null);
  assert.equal((await list(anonymous)).status, 401);
});
