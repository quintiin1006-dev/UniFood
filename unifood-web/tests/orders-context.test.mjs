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

test("BFF obtains context using the session token and ignores all client cafeteria overrides", async () => {
  const calls = [];
  const handler = route(async (url, options) => {
    calls.push([String(url), options]);
    if (String(url).endsWith("/api/worker/context"))
      return Response.json({ cafeteriaId: firstCafeteria });
    return Response.json([{ cafeteriaId: firstCafeteria }]);
  });
  const response = await list(
    handler,
    `?cafeteriaId=${secondCafeteria}&cafeteriaId=forged&userId=forged`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ cafeteriaId: firstCafeteria }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "http://backend.test:8080/api/worker/context");
  assert.equal(
    calls[1][0],
    `http://backend.test:8080/api/orders?cafeteriaId=${firstCafeteria}`,
  );
  for (const [, options] of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(
      options.headers.get("authorization"),
      "Bearer verified-session-token",
    );
  }
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("context is read again on each listing and a revoked context prevents forwarding", async () => {
  let selected = firstCafeteria;
  let contextCalls = 0;
  const orders = [];
  const handler = route(async (url) => {
    if (String(url).endsWith("/api/worker/context")) {
      contextCalls++;
      return selected
        ? Response.json({ cafeteriaId: selected })
        : Response.json({ secret: "database-secret" }, { status: 403 });
    }
    orders.push(new URL(url).searchParams.get("cafeteriaId"));
    return Response.json([]);
  });
  assert.equal((await list(handler)).status, 200);
  selected = secondCafeteria;
  assert.equal((await list(handler)).status, 200);
  selected = null;
  const revoked = await list(handler);
  assert.equal(revoked.status, 403);
  assert.ok(!(await revoked.text()).includes("database-secret"));
  assert.equal(contextCalls, 3);
  assert.deepEqual(orders, [firstCafeteria, secondCafeteria]);
});

test("unavailable, denied or malformed context never falls back or leaks upstream values", async () => {
  for (const [makeResponse, expectedStatus] of [
    ...[401, 403, 400, 500].map((status) => [
      () => Response.json({ message: "provider-secret" }, { status }),
      [401, 403].includes(status) ? status : 502,
    ]),
    [() => Response.json({ cafeteriaId: "provider-secret" }), 502],
    [() => Response.json({}), 502],
    [() => Response.json(null), 502],
    [() => new Response("provider-secret", { status: 200 }), 502],
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
      assert.ok(String(url).endsWith("/api/worker/context"));
      return makeResponse();
    });
    const response = await list(handler);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes("provider-secret"));
    assert.equal(calls, 1);
  }
});
