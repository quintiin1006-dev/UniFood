import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";

const criteria = {
  range: "CUSTOM",
  from: "2024-01-01",
  to: "2024-01-01",
  rankingLimit: 10,
};
const api = (fetchMock) =>
  availabilityLoader({ fetchMock })("features/admin-dashboard/api.ts")
    .adminDashboardApi;
test("a slow browser clock cannot reject a date accepted by the server", async () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-10-23T17:00:00Z"]));
    }
  };
  try {
    const data = adminDashboardFixture({
      from: "2026-10-24",
      to: "2026-10-24",
    });
    let calls = 0;
    const result = await api(async () => {
      calls++;
      return Response.json(data);
    }).get({
      range: "CUSTOM",
      from: "2026-10-24",
      to: "2026-10-24",
      rankingLimit: 10,
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, data);
  } finally {
    globalThis.Date = RealDate;
  }
});
test("browser client uses only same-origin BFF, with no bearer or backend URL", async () => {
  const data = adminDashboardFixture();
  const result = await api(async (url, options) => {
    assert.equal(
      url,
      "/api/admin/dashboard?range=CUSTOM&rankingLimit=10&from=2024-01-01&to=2024-01-01",
    );
    assert.equal(options.method, "GET");
    assert.equal(options.headers, undefined);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(data);
  }).get(criteria);
  assert.deepEqual(result, data);
});
test("browser client applies default limit, validates filters and rejects runtime tenant selectors", async () => {
  const noFetch = api(() => assert.fail("No network request"));
  for (const filters of [
    { ...criteria, cafeteriaId: "FOREIGN" },
    { ...criteria, rankingLimit: 51 },
    { ...criteria, from: "invalid" },
    { ...criteria, range: "TODAY" },
  ])
    await assert.rejects(noFetch.get(filters), (error) => error.status === 400);
  const withoutLimit = {
    range: criteria.range,
    from: criteria.from,
    to: criteria.to,
  };
  assert.deepEqual(
    await api(async () => Response.json(adminDashboardFixture())).get(
      withoutLimit,
    ),
    adminDashboardFixture(),
  );
});
for (const status of [400, 401, 403, 500, 502, 503])
  test(
    "browser error preserves status and sanitizes message: " + status,
    async () => {
      await assert.rejects(
        api(async () =>
          Response.json(
            { message: "PRIVATE_SQL", code: "PRIVATE_CODE" },
            { status },
          ),
        ).get(criteria),
        (error) => error.status === status && !/PRIVATE/.test(error.message),
      );
    },
  );
test("browser client preserves temporary Auth code and response nulls", async () => {
  await assert.rejects(
    api(async () =>
      Response.json({ code: "AUTH_TEMPORARILY_UNAVAILABLE" }, { status: 503 }),
    ).get(criteria),
    (error) =>
      error.status === 503 && error.code === "AUTH_TEMPORARILY_UNAVAILABLE",
  );
  const data = adminDashboardFixture({ unavailable: true });
  assert.deepEqual(
    await api(async () => Response.json(data)).get(criteria),
    data,
  );
});
test("browser rejects malformed data and distinguishes network errors from timeouts", async () => {
  await assert.rejects(
    api(async () => Response.json({})).get(criteria),
    (error) => error.status === 502,
  );
  await assert.rejects(
    api(async () => {
      throw new TypeError("PRIVATE");
    }).get(criteria),
    (error) => error.status === 502,
  );
  await assert.rejects(
    api(async () => {
      throw new DOMException("PRIVATE", "TimeoutError");
    }).get(criteria),
    (error) => error.status === 503,
  );
});
