import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function load(file, environment, fetchMock, mocks, cache = new Map()) {
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

const client = {
  profile: { id: "authenticated-user", active: true, roles: ["CLIENT"] },
  accessToken: "verified-session-token",
};
const route = (fetchMock, auth = client) =>
  load(
    "app/api/me/orders/route.ts",
    { API_URL: "http://backend.test:8080" },
    fetchMock,
    { "@/features/auth/server/session": { getAuth: async () => auth } },
  );
const order = (body, origin = "http://localhost:3100") =>
  new Request("http://localhost:3100/api/me/orders", {
    method: "POST",
    headers: {
      origin,
      host: "localhost:3100",
      "content-type": "application/json",
      "x-forwarded-for": "forged",
    },
    body: JSON.stringify(body),
  });
const validBody = {
  pickupAt: "2026-11-04T12:30:00-05:00",
  items: [{ lunchId: "11111111-1111-1111-1111-111111111111", quantity: 2 }],
};
const accepted = (total = 20000) =>
  Response.json(
    {
      id: "00000000-0000-0000-0000-000000000010",
      status: "PENDING",
      total,
      clientDocument: "PRIVATE",
    },
    { status: 201 },
  );

test("only the session token and the client's choices reach the backend", async () => {
  const calls = [];
  const handler = route(async (url, init) => {
    calls.push({ url: String(url), init });
    return accepted();
  });
  const response = await handler.POST(
    order({
      ...validBody,
      clientId: "forged",
      total: 1,
      items: [{ ...validBody.items[0], price: 1, note: "  sin sal  " }],
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(calls[0].url, "http://backend.test:8080/api/me/orders");
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer verified-session-token",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    pickupAt: "2026-11-04T17:30:00.000Z",
    items: [
      {
        lunchId: "11111111-1111-1111-1111-111111111111",
        quantity: 2,
        note: "sin sal",
      },
    ],
  });
  // The browser receives the acknowledgement, never the upstream order.
  assert.deepEqual(await response.json(), {
    id: "00000000-0000-0000-0000-000000000010",
    status: "PENDING",
    total: 20000,
  });
});

test("a decimal-string total is normalized for the browser", async () => {
  const handler = route(async () => accepted("20000.00"));
  const response = await handler.POST(order(validBody));
  assert.equal((await response.json()).total, 20000);
});

test("malformed carts are rejected before calling the backend", async () => {
  const handler = route(async () => assert.fail("backend must not be called"));
  const item = validBody.items[0];
  for (const body of [
    {},
    { ...validBody, items: [] },
    { ...validBody, pickupAt: undefined },
    { ...validBody, pickupAt: "pronto" },
    { ...validBody, items: [{ ...item, quantity: 0 }] },
    { ...validBody, items: [{ ...item, quantity: 4 }] },
    { ...validBody, items: [{ ...item, quantity: "2" }] },
    { ...validBody, items: [{ ...item, lunchId: "../admin" }] },
    { ...validBody, items: [{ ...item, note: "x".repeat(201) }] },
  ])
    assert.equal((await handler.POST(order(body))).status, 400);
});

test("cross-origin, anonymous and non-client requests never reach the backend", async () => {
  const fail = async () => assert.fail("backend must not be called");
  assert.equal(
    (await route(fail).POST(order(validBody, "https://evil.example"))).status,
    403,
  );
  assert.equal((await route(fail, null).POST(order(validBody))).status, 401);
  assert.equal(
    (
      await route(fail, {
        ...client,
        profile: { ...client.profile, roles: ["WORKER"] },
      }).POST(order(validBody))
    ).status,
    403,
  );
});

test("a temporary auth failure is retryable and never reaches the backend", async () => {
  const handler = load(
    "app/api/me/orders/route.ts",
    { API_URL: "http://backend.test:8080" },
    async () => assert.fail("backend must not be called"),
    {
      "@/features/auth/server/session": {
        getAuth: async () => {
          throw Object.assign(new Error("down"), {
            code: "AUTH_TEMPORARILY_UNAVAILABLE",
          });
        },
      },
    },
  );
  const response = await handler.POST(order(validBody));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal((await response.json()).code, "AUTH_TEMPORARILY_UNAVAILABLE");
});

test("business rejections keep their message; other upstream text stays private", async () => {
  const stock = route(async () =>
    Response.json({ message: "No hay suficientes unidades" }, { status: 409 }),
  );
  const conflict = await stock.POST(order(validBody));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).message, "No hay suficientes unidades");

  const broken = route(async () =>
    Response.json({ message: "PRIVATE_STACK" }, { status: 500 }),
  );
  const failure = await broken.POST(order(validBody));
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /PRIVATE_STACK/);

  const down = route(async () => {
    throw new Error("connection refused");
  });
  assert.equal((await down.POST(order(validBody))).status, 502);
});
