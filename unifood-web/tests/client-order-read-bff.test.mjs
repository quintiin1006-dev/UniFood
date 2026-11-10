import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const require = createRequire(import.meta.url);
const {
  unstable_doesMiddlewareMatch,
} = require("next/experimental/testing/server");

const ORDER = "00000000-0000-0000-0000-000000000051";
const TAG = '"0123456789abcdef0123456789abcdef"';
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const order = {
  id: ORDER,
  status: "READY",
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
  cafeteria: { id: "00000000-0000-0000-0000-000000000031", name: "Central" },
  cancellationSource: null,
  rejectionReason: null,
};

function routes({ auth = client, fetchMock, authError = null } = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchMock) return fetchMock(url, options);
      return Response.json(order, {
        headers: {
          "cache-control": "no-cache, private",
          etag: TAG,
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
  return {
    calls,
    current: load("app/api/me/orders/current/route.ts").GET,
    history: load("app/api/me/orders/route.ts").GET,
    detail: load("app/api/me/orders/[orderId]/route.ts").GET,
  };
}

const get = (path, headers = {}) =>
  new Request(`http://browser.test${path}`, {
    headers: { host: "browser.test", ...headers },
  });
const params = (orderId) => ({ params: Promise.resolve({ orderId }) });

/** Each read, called the way Next calls it. */
function all(handlers) {
  return [
    () => handlers.current(get("/api/me/orders/current")),
    () => handlers.history(get("/api/me/orders")),
    () => handlers.detail(get(`/api/me/orders/${ORDER}`), params(ORDER)),
  ];
}

test("the proxy refreshes the session on every read route", () => {
  const source = fs.readFileSync("proxy.ts", "utf8");
  const matcher = [
    ...source.slice(source.indexOf("matcher:")).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  for (const path of [
    "/api/me/orders",
    "/api/me/orders/current",
    `/api/me/orders/${ORDER}`,
  ])
    assert.ok(
      unstable_doesMiddlewareMatch({
        config: { matcher },
        url: `http://browser.test${path}`,
      }),
      path,
    );
});

test("without a session every read is 401 and Spring is never called", async () => {
  const handlers = routes({ auth: null });
  for (const call of all(handlers)) {
    const response = await call();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, "UNAUTHORIZED");
  }
  assert.equal(handlers.calls.length, 0);
});

test("a temporary auth outage keeps the generic retryable answer", async () => {
  const outage = Object.assign(new Error("auth down"), {
    code: "AUTH_TEMPORARILY_UNAVAILABLE",
  });
  const handlers = routes({ authError: outage });
  for (const call of all(handlers)) {
    const response = await call();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
  }
  assert.equal(handlers.calls.length, 0);
});

test("only an exclusive CLIENT reaches Spring", async () => {
  for (const roles of [
    ["WORKER"],
    ["ADMIN"],
    ["SUPER_ADMIN"],
    [],
    ["CLIENT", "WORKER"],
  ]) {
    const handlers = routes({
      auth: { ...client, profile: { ...client.profile, roles } },
    });
    for (const call of all(handlers)) {
      const response = await call();
      assert.equal(response.status, 403, roles.join());
      assert.equal((await response.json()).code, "FORBIDDEN");
    }
    assert.equal(handlers.calls.length, 0, roles.join());
  }
});

test("only the session bearer reaches Spring, never the browser's headers", async () => {
  const handlers = routes();
  const forged = {
    authorization: "Bearer forged-by-browser",
    cookie: "sb-x-auth-token=PRIVATE",
    "x-forwarded-for": "1.2.3.4",
  };
  await handlers.current(get("/api/me/orders/current", forged));
  await handlers.history(get("/api/me/orders?userId=forged", forged));
  await handlers.detail(get(`/api/me/orders/${ORDER}`, forged), params(ORDER));
  assert.deepEqual(
    handlers.calls.map((call) => call.url),
    [
      "http://backend.test:8080/api/me/orders/current",
      "http://backend.test:8080/api/me/orders",
      `http://backend.test:8080/api/me/orders/${ORDER}`,
    ],
  );
  for (const { options } of handlers.calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, {
      authorization: "Bearer verified-session-token",
      accept: "application/json",
    });
  }
});

test("the current order passes Spring's tag, polling cache and body through", async () => {
  const handlers = routes();
  const response = await handlers.current(get("/api/me/orders/current"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), TAG);
  assert.equal(response.headers.get("cache-control"), "no-cache, private");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-internal"), null);
  assert.deepEqual(await response.json(), order);
});

test("If-None-Match reaches Spring and its 304 comes back without a body", async () => {
  const handlers = routes({
    fetchMock: async () =>
      new Response(null, {
        status: 304,
        headers: { etag: TAG, "cache-control": "no-cache, private" },
      }),
  });
  const response = await handlers.current(
    get("/api/me/orders/current", { "if-none-match": TAG }),
  );
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), TAG);
  assert.equal(await response.text(), "");
  assert.equal(handlers.calls[0].options.headers["if-none-match"], TAG);

  // An oversized header is dropped rather than forwarded.
  const big = routes();
  await big.current(
    get("/api/me/orders/current", { "if-none-match": "x".repeat(600) }),
  );
  assert.equal(big.calls[0].options.headers["if-none-match"], undefined);
});

test("no active order is Spring's JSON null, kept as is", async () => {
  const handlers = routes({
    fetchMock: async () =>
      new Response("null", {
        headers: {
          "content-type": "application/json",
          etag: TAG,
          "cache-control": "no-cache, private",
        },
      }),
  });
  const response = await handlers.current(get("/api/me/orders/current"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "null");
});

test("the history forwards only a well-formed cursor and limit", async () => {
  const handlers = routes();
  await handlers.history(
    get("/api/me/orders?cursor=YzE6MTox_-A&limit=10&clientId=forged&extra=1"),
  );
  await handlers.history(get("/api/me/orders?cursor=&limit="));
  await handlers.history(get("/api/me/orders?limit=50"));
  assert.deepEqual(
    handlers.calls.map((call) => call.url),
    [
      "http://backend.test:8080/api/me/orders?cursor=YzE6MTox_-A&limit=10",
      "http://backend.test:8080/api/me/orders",
      "http://backend.test:8080/api/me/orders?limit=50",
    ],
  );
});

test("a bad cursor or a limit outside 1-50 never reaches Spring", async () => {
  for (const query of [
    "limit=0",
    "limit=51",
    "limit=-1",
    "limit=1.5",
    "limit=abc",
    "limit=100",
    "cursor=%25%25",
    "cursor=a%20b",
    "cursor=a.b",
    `cursor=${"A".repeat(97)}`,
  ]) {
    const handlers = routes();
    const response = await handlers.history(get(`/api/me/orders?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, "INVALID_ORDER_REQUEST");
    assert.equal(handlers.calls.length, 0, query);
  }
});

test("a malformed order id is the same 404 without calling Spring", async () => {
  for (const id of ["not-a-uuid", "..%2Fcurrent", `${ORDER}x`, "current"]) {
    const handlers = routes();
    const response = await handlers.detail(
      get(`/api/me/orders/${id}`),
      params(id),
    );
    assert.equal(response.status, 404, id);
    assert.equal((await response.json()).code, "ORDER_NOT_FOUND");
    assert.equal(handlers.calls.length, 0);
  }
});

test("Spring's errors keep their status and code", async () => {
  for (const [status, code] of [
    [400, "INVALID_ORDER_REQUEST"],
    [403, "FORBIDDEN"],
    [404, "ORDER_NOT_FOUND"],
    [503, "ORDER_TEMPORARILY_UNAVAILABLE"],
  ]) {
    const body = { status, code, message: "Mensaje fijo" };
    const handlers = routes({
      fetchMock: async () =>
        Response.json(body, {
          status,
          headers: {
            "cache-control": "no-store",
            ...(status === 503 ? { "retry-after": "5" } : {}),
          },
        }),
    });
    for (const call of all(handlers)) {
      const response = await call();
      assert.equal(response.status, status, code);
      assert.deepEqual(await response.json(), body);
      if (status === 503)
        assert.equal(response.headers.get("retry-after"), "5");
    }
  }
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
    async () => new Response("ok", { status: 200 }),
    async () => Response.json({}, { status: 302 }),
    // A 304 the browser never asked for is not a valid answer.
    async () => new Response(null, { status: 304 }),
  ];
  for (const fetchMock of failures) {
    const handlers = routes({ fetchMock });
    for (const call of all(handlers)) {
      const response = await call();
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.ok(!text.includes("PRIVATE"), text);
      assert.equal(JSON.parse(text).code, "BACKEND_UNAVAILABLE");
    }
  }
});
