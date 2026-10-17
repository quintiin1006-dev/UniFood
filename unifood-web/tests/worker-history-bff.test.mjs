import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";

const root = "/api/worker/orders/history/today";
const worker = {
  profile: { active: true, roles: ["WORKER"] },
  accessToken: "verified-session-token",
};
function route(fetchMock, auth = worker, getAuth = async () => auth) {
  return availabilityLoader({
    fetchMock,
    mocks: { "@/features/auth/server/session": { getAuth } },
  })(`app${root}/route.ts`).GET;
}
test("history BFF forwards only verified WORKER identity and picks the no-store DTO", async () => {
  const calls = [];
  const payload = workerHistoryFixture();
  payload.privateToken = "PRIVATE";
  payload.orders[0].clientDocument = "PRIVATE";
  payload.orders[0].email = "PRIVATE";
  payload.orders[0].phone = "PRIVATE";
  payload.orders[0].clientId = "PRIVATE";
  payload.orders[0].authMetadata = "PRIVATE";
  payload.orders[0].items[0].lunchId = "PRIVATE";
  const response = await route(async (url, options) => {
    calls.push({ url, options });
    return Response.json(payload, { headers: { "set-cookie": "PRIVATE" } });
  })(
    new Request(
      `http://localhost:3100${root}?cafeteriaId=FOREIGN&date=1900-01-01&status=PENDING`,
      {
        headers: {
          authorization: "Bearer forged",
          "x-cafeteria-id": "FOREIGN",
        },
      },
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), workerHistoryFixture());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `http://backend.test:8080${root}`);
  assert.deepEqual(calls[0].options.headers, {
    authorization: "Bearer verified-session-token",
    accept: "application/json",
  });
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});
test("history BFF denies absent, inactive and every non-exclusive WORKER before Spring", async () => {
  for (const [auth, status] of [
    [null, 401],
    [{ ...worker, profile: { active: false, roles: ["WORKER"] } }, 403],
    ...[
      [],
      ["CLIENT"],
      ["ADMIN"],
      ["SUPER_ADMIN"],
      ["WORKER", "CLIENT"],
      ["WORKER", "ADMIN"],
    ].map((roles) => [{ ...worker, profile: { active: true, roles } }, 403]),
  ]) {
    const response = await route(
      async () => assert.fail("Must not reach Spring"),
      auth,
    )();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("upstream errors never leak details or cookies and preserve safe status contracts", async () => {
  for (const [upstream, expected, code] of [
    [401, 401, "WORKER_HISTORY_UNAUTHORIZED"],
    [403, 403, "WORKER_HISTORY_FORBIDDEN"],
    [500, 500, "WORKER_HISTORY_INTERNAL_ERROR"],
    [503, 503, "WORKER_HISTORY_TEMPORARILY_UNAVAILABLE"],
    [502, 503, "WORKER_HISTORY_TEMPORARILY_UNAVAILABLE"],
    [302, 502, "WORKER_HISTORY_BAD_GATEWAY"],
  ]) {
    const response = await route(async () =>
      Response.json(
        { message: "SQL PRIVATE", code: "PRIVATE" },
        {
          status: upstream,
          headers: {
            "set-cookie": "PRIVATE",
            "retry-after": "9",
            location: "https://private.invalid",
          },
        },
      ),
    )();
    assert.equal(response.status, expected);
    assert.equal((await response.json()).code, code);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      response.headers.get("retry-after"),
      expected === 503 ? "9" : null,
    );
  }
});
test("temporary Auth and transport/body timeouts retain session and are recoverable", async () => {
  const authFailure = await route(
    async () => assert.fail("No business request"),
    worker,
    async () => {
      throw Object.assign(new Error("PRIVATE"), {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
      });
    },
  )();
  assert.equal(authFailure.status, 503);
  assert.equal((await authFailure.json()).code, "AUTH_TEMPORARILY_UNAVAILABLE");
  assert.equal(authFailure.headers.get("set-cookie"), null);
  for (const fetchMock of [
    async () => {
      throw new TypeError("PRIVATE network");
    },
    async () => {
      throw new DOMException("PRIVATE", "TimeoutError");
    },
    async () => ({
      status: 200,
      json: async () => {
        throw new DOMException("PRIVATE", "AbortError");
      },
    }),
  ]) {
    const response = await route(fetchMock)();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.ok(!(await response.text()).includes("PRIVATE"));
  }
  assert.equal(
    (await route(async () => Response.json(workerHistoryFixture()))()).status,
    200,
  );
});
test("history BFF rejects malformed success JSON instead of presenting an empty history", async () => {
  for (const data of [
    null,
    {},
    [],
    {
      ...workerHistoryFixture(),
      orders: [{ ...workerHistoryFixture().orders[0], clientName: 42 }],
    },
    {
      ...workerHistoryFixture(),
      orders: [{ ...workerHistoryFixture().orders[0], status: "PENDING" }],
    },
  ])
    assert.equal((await route(async () => Response.json(data))()).status, 502);
  const response = await route(
    async () => new Response("<html>PRIVATE</html>"),
  )();
  assert.equal(response.status, 502);
});
