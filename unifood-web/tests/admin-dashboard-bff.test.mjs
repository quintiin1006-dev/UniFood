import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";

const identity = { id: "verified-subject", accessToken: "verified-token" };
const admission = { id: identity.id, active: true, roles: ["ADMIN"] };
const now = new Date("2026-10-24T17:00:00Z");
const custom = "range=CUSTOM&from=2024-01-01&to=2024-01-01";
function request(query = custom, headers = {}) {
  return new Request("http://browser/api/admin/dashboard?" + query, {
    headers,
  });
}
function route({
  auth = identity,
  profile = admission,
  authError,
  admissionError = null,
  admissionStatus,
  fetchMock = async () => Response.json(adminDashboardFixture()),
  environment,
} = {}) {
  const load = availabilityLoader({
    fetchMock,
    ...(environment ? { environment } : {}),
    mocks: {
      "@/features/auth/server/identity": {
        getVerifiedAuthIdentity: async () => {
          if (authError) throw authError;
          return auth;
        },
      },
      "@/features/auth/server/client": {
        authClient: async () => ({
          rpc: async (name) => {
            assert.equal(name, "current_auth_profile");
            return {
              data: profile,
              error: admissionError,
              status: admissionStatus,
            };
          },
        }),
      },
    },
  });
  return {
    GET: (input) =>
      load("features/admin-dashboard/server/forward.ts").forwardAdminDashboard(
        input ?? request(),
        now,
      ),
    route: () => load("app/api/admin/dashboard/route.ts"),
  };
}
async function safeError(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  for (const name of ["Set-Cookie", "Location", "Authorization"])
    assert.equal(response.headers.get(name), null);
  const body = await response.json();
  assert.equal(body.status, status);
  assert.equal(typeof body.code, "string");
  assert.doesNotMatch(
    JSON.stringify(body),
    /PRIVATE|verified-token|Bearer|backend\.test|SQL|trace|password/,
  );
  return body;
}
test("actual GET route uses verified session and an allowlisted upstream URL, projects DTO and no-store", async () => {
  const clean = adminDashboardFixture(),
    raw = structuredClone(clean);
  raw.clientName = "PRIVATE_STUDENT";
  raw.summary.token = "PRIVATE_TOKEN";
  const handler = route({
    fetchMock: async (url, options) => {
      assert.equal(
        url,
        "http://backend.test:8080/api/admin/dashboard?range=CUSTOM&rankingLimit=10&from=2024-01-01&to=2024-01-01",
      );
      assert.deepEqual(options.headers, {
        authorization: "Bearer verified-token",
        accept: "application/json",
      });
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(raw, {
        headers: {
          "set-cookie": "PRIVATE_COOKIE",
          location: "https://private.invalid",
          authorization: "PRIVATE_TOKEN",
        },
      });
    },
  }).route();
  assert.equal(handler.dynamic, "force-dynamic");
  const response = await handler.GET(
    request(custom, {
      authorization: "Bearer forged",
      cookie: "PRIVATE_COOKIE",
      "X-Cafeteria-Id": "FOREIGN",
      "X-User-Id": "FOREIGN",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(await response.json(), clean);
});
for (const [range, from] of [
  ["TODAY", "2026-10-24"],
  ["LAST_7_DAYS", "2026-10-18"],
  ["LAST_30_DAYS", "2026-09-25"],
])
  test("BFF accepts preset " + range, async () => {
    const data = adminDashboardFixture({ range, from, to: "2026-10-24" });
    const response = await route({
      fetchMock: async (url) => {
        assert.equal(
          new URL(url).search,
          "?range=" + range + "&rankingLimit=10",
        );
        return Response.json(data);
      },
    }).GET(request("range=" + range));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), data);
  });
for (const auth of [null, { ...identity, accessToken: "" }])
  test(
    "missing/invalid session prevents any business call: " +
      JSON.stringify(auth),
    async () => {
      await safeError(
        await route({
          auth,
          fetchMock: () => assert.fail("No business call"),
        }).GET(),
        401,
      );
    },
  );
for (const profile of [
  null,
  { ...admission, active: false },
  { ...admission, id: "FOREIGN" },
  ...[
    [],
    ["CLIENT"],
    ["WORKER"],
    ["SUPER_ADMIN"],
    ["ADMIN", "WORKER"],
    ["ADMIN", "ADMIN"],
  ].map((roles) => ({ ...admission, roles })),
])
  test(
    "incorrect business profile is forbidden: " + JSON.stringify(profile),
    async () => {
      await safeError(
        await route({
          profile,
          fetchMock: () => assert.fail("No business call"),
        }).GET(),
        403,
      );
    },
  );
for (const code of [
  "jwt_expired",
  "bad_jwt",
  "session_expired",
  "refresh_token_expired",
])
  test("expired or rejected session maps to 401: " + code, async () => {
    const error = Object.assign(new Error("PRIVATE_AUTH"), {
      status: 401,
      code,
    });
    await safeError(
      await route({
        authError: error,
        fetchMock: () => assert.fail("No business call"),
      }).GET(),
      401,
    );
  });
for (const status of [401, 403])
  test("profile RPC admission preserves " + status, async () => {
    await safeError(
      await route({
        admissionError: { status, message: "PRIVATE" },
        admissionStatus: status,
        fetchMock: () => assert.fail("No business call"),
      }).GET(),
      status,
    );
  });
test("temporary Auth failure preserves cookies and session recovery", async () => {
  for (const options of [
    { authError: new TypeError("PRIVATE fetch failed") },
    {
      admissionError: { status: 503, message: "PRIVATE" },
      admissionStatus: 503,
    },
  ]) {
    const response = await route({
      ...options,
      fetchMock: () => assert.fail("No business call"),
    }).GET();
    assert.equal(response.headers.get("retry-after"), "5");
    assert.equal(
      (await safeError(response, 503)).code,
      "AUTH_TEMPORARILY_UNAVAILABLE",
    );
  }
  assert.equal((await route().GET()).status, 200);
});
for (const query of [
  "",
  "range=TODAY&range=TODAY",
  "range=CUSTOM&from=2024-02-30&to=2024-03-01",
  "range=CUSTOM&from=2026-10-25&to=2026-10-25",
  "range=CUSTOM&from=2024-01-02&to=2024-01-01",
  "range=CUSTOM&from=2024-01-01&to=2025-01-01",
  "range=TODAY&rankingLimit=51",
  "range=TODAY&rankingLimit=0",
  ...[
    "cafeteriaId",
    "userId",
    "timezone",
    "asOf",
    "institutionId",
    "tenantId",
  ].map((key) => "range=TODAY&" + key + "=FOREIGN"),
])
  test(
    "BFF filter rejection occurs before upstream fetch: " + query,
    async () => {
      await safeError(
        await route({ fetchMock: () => assert.fail("No business call") }).GET(
          request(query),
        ),
        400,
      );
    },
  );
for (const status of [400, 401, 403, 500, 502, 503])
  test(
    "public upstream error semantics and private-body sanitization: " + status,
    async () => {
      const response = await route({
        fetchMock: async () =>
          Response.json(
            {
              message: "PRIVATE_SQL",
              trace: "PRIVATE_TRACE",
              token: "PRIVATE",
            },
            {
              status,
              headers: {
                "Retry-After": "9",
                "Set-Cookie": "PRIVATE",
                Location: "https://private.invalid",
              },
            },
          ),
      }).GET();
      assert.equal(
        response.headers.get("Retry-After"),
        status === 503 ? "9" : null,
      );
      await safeError(response, status);
    },
  );
for (const status of [302, 404, 408, 429, 504])
  test(
    "unexpected upstream status is normalized safely: " + status,
    async () => {
      await safeError(
        await route({
          fetchMock: async () => new Response("PRIVATE", { status }),
        }).GET(),
        [408, 429, 504].includes(status) ? 503 : 502,
      );
    },
  );
test("Retry-After is bounded and never forwards arbitrary header text", async () => {
  for (const retry of ["0", "301", "9999", "tomorrow", "-1", "0005"]) {
    const response = await route({
      fetchMock: async () =>
        new Response(null, { status: 503, headers: { "Retry-After": retry } }),
    }).GET();
    assert.equal(response.headers.get("Retry-After"), "5");
    await safeError(response, 503);
  }
});
test("backend disconnect is 502 and fetch/body timeout is 503", async () => {
  await safeError(
    await route({
      fetchMock: async () => {
        throw new TypeError("PRIVATE_CONNECTION");
      },
    }).GET(),
    502,
  );
  await safeError(
    await route({
      fetchMock: async () => {
        throw new DOMException("PRIVATE", "TimeoutError");
      },
    }).GET(),
    503,
  );
  await safeError(
    await route({
      fetchMock: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => {
          throw new DOMException("PRIVATE", "AbortError");
        },
      }),
    }).GET(),
    503,
  );
});
test("invalid JSON, content type and incomplete DTO return safe 502", async () => {
  for (const upstream of [
    new Response("{broken", {
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify(adminDashboardFixture()), {
      headers: { "content-type": "text/html" },
    }),
    Response.json({}),
    Response.json(null),
    Response.json({ period: [] }),
  ])
    await safeError(
      await route({ fetchMock: async () => upstream }).GET(),
      502,
    );
});
test("misconfigured backend is a sanitized internal error", async () => {
  await safeError(
    await route({
      environment: { API_URL: "PRIVATE_INVALID" },
      fetchMock: () => assert.fail("No business call"),
    }).GET(),
    500,
  );
});
test("unavailable rankings and limited coverage pass through without null-to-zero conversion", async () => {
  const data = adminDashboardFixture({ unavailable: true });
  const response = await route({
    fetchMock: async () => Response.json(data),
  }).GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), data);
});
test("all unsupported methods are 405 with no-store, without touching Auth or Spring", async () => {
  const handlers = route({
    authError: new Error("Must not verify Auth"),
    fetchMock: () => assert.fail("No business call"),
  }).route();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await handlers[method]();
    await safeError(response, 405);
    assert.equal(response.headers.get("Allow"), "GET");
  }
});
