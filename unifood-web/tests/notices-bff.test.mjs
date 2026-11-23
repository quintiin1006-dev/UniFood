import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/campana-avisos · PR 2: GET /api/me/notices and POST /api/me/notices/read in the BFF.

const ORIGIN = "http://localhost:3400";
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const upstreamBody = {
  unread: 1,
  notices: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "CALLED",
      sequence: 0,
      orderId: "00000000-0000-4000-8000-0000000000aa",
      orderActive: true,
      createdAt: new Date().toISOString(),
      read: false,
      userId: "someone-else",
    },
  ],
};

const UNSET = Symbol("unset");
function bff({
  auth = client,
  enabled = "true",
  status = 200,
  body = upstreamBody,
  fetchError = null,
} = {}) {
  const calls = [];
  const environment = { API_URL: "http://backend.test:8080" };
  if (enabled !== UNSET) environment.AVISOS_BANDEJA_ENABLED = enabled;
  const load = availabilityLoader({
    environment,
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchError) throw fetchError;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "set-cookie": "X=1" },
      });
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return {
    calls,
    GET: load("app/api/me/notices/route.ts").GET,
    POST: load("app/api/me/notices/read/route.ts").POST,
  };
}
const post = (origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/me/notices/read`, {
    method: "POST",
    headers: { host: "localhost:3400", ...(origin ? { origin } : {}) },
  });

const noStore = (response) =>
  assert.equal(response.headers.get("cache-control"), "no-store");

test("flag off, unset or malformed: both routes answer 404 no-store and never call Spring", async () => {
  for (const enabled of ["false", UNSET, "maybe", ""]) {
    const { calls, GET, POST } = bff({ enabled });
    for (const response of [await GET(), await POST(post())]) {
      assert.equal(response.status, 404, String(enabled));
      noStore(response);
      assert.equal((await response.json()).code, "ORDER_NOTICES_DISABLED");
    }
    assert.equal(calls.length, 0);
  }
});

test("without a session 401, a non-client or mixed role 403, before Spring", async () => {
  const anonymous = bff({ auth: null });
  assert.equal((await anonymous.GET()).status, 401);
  assert.equal(anonymous.calls.length, 0);
  for (const roles of [["WORKER"], ["ADMIN"], ["CLIENT", "WORKER"], []]) {
    const { calls, GET, POST } = bff({
      auth: { ...client, profile: { ...client.profile, roles } },
    });
    const response = await GET();
    assert.equal(response.status, 403, roles.join());
    noStore(response);
    assert.equal((await POST(post())).status, 403);
    assert.equal(calls.length, 0);
  }
});

test("GET forwards with the session bearer, no-store, no redirects and a timeout", async () => {
  const { calls, GET } = bff();
  const response = await GET();
  assert.equal(response.status, 200);
  noStore(response);
  assert.equal(response.headers.get("set-cookie"), null);
  const body = await response.json();
  assert.equal(body.unread, 1);
  assert.equal(body.notices[0].kind, "CALLED");
  assert.equal(body.notices[0].userId, undefined);
  const [{ url, options }] = calls;
  assert.equal(url, "http://backend.test:8080/api/me/notices");
  assert.equal(options.method, "GET");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.authorization, "Bearer verified-session-token");
});

test("POST demands the same origin and answers 200 no-store, also when already read", async () => {
  for (const origin of ["https://evil.example", null]) {
    const { calls, POST } = bff();
    const response = await POST(post(origin));
    assert.equal(response.status, 403);
    noStore(response);
    assert.equal(calls.length, 0);
  }
  const { calls, POST } = bff({ body: { notices: [], unread: 0 } });
  for (let i = 0; i < 2; i++) {
    const response = await POST(post());
    assert.equal(response.status, 200);
    noStore(response);
    assert.deepEqual(await response.json(), { unread: 0 });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://backend.test:8080/api/me/notices/read");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.cache, "no-store");
});

test("backend failures are translated, never relayed", async () => {
  const cases = [
    [403, 403, "ORDER_NOTICES_FORBIDDEN"],
    [404, 404, "ORDER_NOTICES_DISABLED"],
    [503, 503, "ORDER_NOTICES_TEMPORARILY_UNAVAILABLE"],
    [500, 502, "BACKEND_UNAVAILABLE"],
  ];
  for (const [upstream, expected, code] of cases) {
    const { GET } = bff({
      status: upstream,
      body: { code: "PRIVATE_DETAIL", message: "stack trace" },
    });
    const response = await GET();
    assert.equal(response.status, expected);
    noStore(response);
    const text = await response.text();
    assert.ok(text.includes(code), code);
    assert.doesNotMatch(text, /PRIVATE_DETAIL|stack trace/);
  }
  const malformed = await bff({ body: { notices: "x" } }).GET();
  assert.equal(malformed.status, 502);
  const down = await bff({
    fetchError: new Error("connect ECONNREFUSED"),
  }).GET();
  assert.equal(down.status, 503);
  noStore(down);
  assert.doesNotMatch(await down.text(), /ECONNREFUSED/);
});
