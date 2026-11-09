import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const require = createRequire(import.meta.url);
const {
  unstable_doesMiddlewareMatch,
} = require("next/experimental/testing/server");

const CAFETERIA = "00000000-0000-0000-0000-000000000031";
const JUICE = "00000000-0000-0000-0000-000000000041";
const KEY = "key-0123456789abcdef";
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const created = {
  id: "00000000-0000-0000-0000-000000000051",
  status: "PENDING",
  total: "9000.00",
  note: null,
  createdAt: "2026-11-20T17:00:00Z",
  items: [
    {
      name: "Jugo natural",
      quantity: 2,
      unitPrice: "4500.00",
      subtotal: "9000.00",
    },
  ],
};

function route({ auth = client, fetchMock, authError = null } = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchMock) return fetchMock(url, options);
      return Response.json(created, {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "set-cookie": "PRIVATE=1",
          "x-internal": "PRIVATE",
        },
      });
    },
    mocks: {
      "@/features/auth/server/session": {
        getAuth: async () => {
          if (authError) throw authError;
          return auth;
        },
      },
    },
  });
  return { calls, POST: load("app/api/me/orders/route.ts").POST };
}

const order = (overrides = {}) => ({
  cafeteriaId: CAFETERIA,
  items: [{ productId: JUICE, quantity: 2 }],
  ...overrides,
});

function request({
  body = order(),
  headers = {},
  origin = "http://browser.test",
  key = KEY,
} = {}) {
  return new Request("http://browser.test/api/me/orders", {
    method: "POST",
    headers: {
      host: "browser.test",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("the proxy refreshes the session on the create-order route", () => {
  const source = fs.readFileSync("proxy.ts", "utf8");
  const matcher = [
    ...source.slice(source.indexOf("matcher:")).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(
    unstable_doesMiddlewareMatch({
      config: { matcher },
      url: "http://browser.test/api/me/orders",
    }),
  );
});

test("a cross-origin or origin-less POST is refused before the session or Spring", async () => {
  for (const origin of ["https://evil.example", null]) {
    let sessionRead = false;
    const { calls, POST } = route({
      authError: null,
      auth: new Proxy(client, {
        get(target, prop) {
          sessionRead = true;
          return target[prop];
        },
      }),
    });
    const response = await POST(request({ origin }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
    assert.equal(sessionRead, false);
  }
});

test("without a session it answers 401 and never calls Spring", async () => {
  const { calls, POST } = route({ auth: null });
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "UNAUTHORIZED");
  assert.equal(calls.length, 0);
});

test("a temporary auth outage keeps the generic retryable answer", async () => {
  const outage = Object.assign(new Error("auth down"), {
    code: "AUTH_TEMPORARILY_UNAVAILABLE",
  });
  const { calls, POST } = route({ authError: outage });
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal((await response.json()).code, "AUTH_TEMPORARILY_UNAVAILABLE");
  assert.equal(calls.length, 0);
});

test("only an exclusive CLIENT reaches Spring", async () => {
  for (const roles of [
    ["WORKER"],
    ["ADMIN"],
    ["SUPER_ADMIN"],
    [],
    ["CLIENT", "WORKER"],
  ]) {
    const { calls, POST } = route({
      auth: { ...client, profile: { ...client.profile, roles } },
    });
    const response = await POST(request());
    assert.equal(response.status, 403, roles.join());
    assert.equal((await response.json()).code, "FORBIDDEN");
    assert.equal(calls.length, 0, roles.join());
  }
});

test("a missing or malformed Idempotency-Key is rejected before Spring", async () => {
  for (const key of [
    null,
    "short",
    "has spaces 0123456789",
    "k".repeat(129),
    "ñandú-0123456789abc",
  ]) {
    const { calls, POST } = route();
    const response = await POST(request({ key }));
    assert.equal(response.status, 400, String(key));
    assert.equal((await response.json()).code, "INVALID_ORDER_REQUEST");
    assert.equal(calls.length, 0);
  }
});

test("malformed bodies are rejected before Spring", async () => {
  const bodies = [
    "",
    "{",
    "[]",
    "null",
    JSON.stringify(order({ cafeteriaId: "not-a-uuid" })),
    JSON.stringify(order({ cafeteriaId: undefined })),
    JSON.stringify(order({ items: [] })),
    JSON.stringify(order({ items: "x" })),
    JSON.stringify(order({ items: [null] })),
    JSON.stringify(order({ items: [{ productId: "x", quantity: 1 }] })),
    JSON.stringify(order({ items: [{ productId: JUICE, quantity: 0 }] })),
    JSON.stringify(order({ items: [{ productId: JUICE, quantity: 1.5 }] })),
    JSON.stringify(order({ items: [{ productId: JUICE, quantity: "1" }] })),
    JSON.stringify(order({ note: 5 })),
    JSON.stringify(order({ note: "x".repeat(9000) })),
  ];
  for (const body of bodies) {
    const { calls, POST } = route();
    const response = await POST(request({ body }));
    assert.equal(response.status, 400, body.slice(0, 60));
    assert.equal((await response.json()).code, "INVALID_ORDER_REQUEST");
    assert.equal(calls.length, 0);
  }
  const { calls, POST } = route();
  const text = await POST(
    request({ headers: { "content-type": "text/plain" } }),
  );
  assert.equal(text.status, 400);
  assert.equal(calls.length, 0);
});

test("the session bearer and a rebuilt body are all that reach Spring", async () => {
  const { calls, POST } = route();
  const response = await POST(
    request({
      headers: {
        authorization: "Bearer forged-by-browser",
        cookie: "sb-x-auth-token=PRIVATE",
        "x-forwarded-for": "1.2.3.4",
      },
      body: {
        ...order({ note: "  Sin hielo " }),
        total: "0.01",
        clientId: "forged",
        items: [
          {
            productId: JUICE,
            quantity: 2,
            unitPrice: "0.01",
            subtotal: "0.02",
            name: "Gratis",
          },
        ],
      },
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(url, "http://backend.test:8080/api/me/orders");
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(options.headers, {
    authorization: "Bearer verified-session-token",
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": KEY,
  });
  // The note goes as typed: Spring trims it and hashes it.
  assert.deepEqual(JSON.parse(options.body), {
    cafeteriaId: CAFETERIA,
    items: [{ productId: JUICE, quantity: 2 }],
    note: "  Sin hielo ",
  });
});

test("Spring's created order and a replay pass through without internal headers", async () => {
  for (const status of [201, 200]) {
    const { POST } = route({
      fetchMock: async () =>
        Response.json(created, {
          status,
          headers: { "set-cookie": "PRIVATE=1", "x-internal": "PRIVATE" },
        }),
    });
    const response = await POST(request());
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-internal"), null);
    assert.deepEqual(await response.json(), created);
  }
});

test("Spring's business errors keep their status, code and activeOrderId", async () => {
  const errors = [
    [400, "ORDER_LIMIT_EXCEEDED"],
    [400, "ORDER_NOTE_TOO_LONG"],
    [403, "CAFETERIA_NOT_SUBSCRIBED"],
    [404, "CAFETERIA_NOT_FOUND"],
    [409, "CAFETERIA_CLOSED"],
    [409, "PRODUCT_UNAVAILABLE"],
    [409, "IDEMPOTENCY_KEY_CONFLICT"],
    [409, "ACTIVE_ORDER_EXISTS"],
  ];
  for (const [status, code] of errors) {
    const body = {
      status,
      code,
      message: "Mensaje fijo",
      timestamp: "2026-11-20T17:00:00Z",
      path: "/api/me/orders",
      ...(code === "ACTIVE_ORDER_EXISTS" ? { activeOrderId: created.id } : {}),
    };
    const { POST } = route({
      fetchMock: async () => Response.json(body, { status }),
    });
    const response = await POST(request());
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), body);
  }
});

test("a temporary Spring failure keeps Retry-After", async () => {
  const { POST } = route({
    fetchMock: async () =>
      Response.json(
        { status: 503, code: "ORDER_TEMPORARILY_UNAVAILABLE", message: "x" },
        { status: 503, headers: { "retry-after": "5" } },
      ),
  });
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
});

test("network failures, timeouts, redirects and raw errors become a generic 502", async () => {
  const failures = [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
    async () =>
      new Response("<html>stack trace PRIVATE</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    async () => Response.json({ trace: "PRIVATE" }, { status: 500 }),
    async () => new Response("ok", { status: 201 }),
    async () => Response.json({}, { status: 302 }),
  ];
  for (const fetchMock of failures) {
    const { POST } = route({ fetchMock });
    const response = await POST(request());
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.ok(!text.includes("PRIVATE"), text);
    assert.equal(JSON.parse(text).code, "BACKEND_UNAVAILABLE");
  }
});
