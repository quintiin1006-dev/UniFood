import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminCatalogFixture } from "./helpers/admin-catalog-fixture.mjs";

const identity = { id: "verified-subject", accessToken: "verified-token" };
const admission = { id: identity.id, active: true, roles: ["ADMIN"] };
function route({
  auth = identity,
  profile = admission,
  error = null,
  authError = null,
  admissionStatus = undefined,
  fetchMock = async () => Response.json(adminCatalogFixture()),
} = {}) {
  return availabilityLoader({
    fetchMock,
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
            return { data: profile, error, status: admissionStatus };
          },
        }),
      },
    },
  })("app/api/admin/catalog/route.ts").GET;
}
test("catalog BFF forwards only verified bearer to Spring and strips private data without forwarding tenant selectors", async () => {
  const raw = adminCatalogFixture();
  raw.products[0].cafeteriaId = "PRIVATE";
  raw.email = "PRIVATE";
  const response = await route({
    fetchMock: async (url, options) => {
      assert.equal(url, "http://backend.test:8080/api/admin/catalog");
      assert.deepEqual(options.headers, {
        authorization: "Bearer verified-token",
        accept: "application/json",
      });
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(raw, { headers: { "set-cookie": "PRIVATE" } });
    },
  })(
    new Request(
      "http://browser/api/admin/catalog?cafeteriaId=FOREIGN&userId=FOREIGN&institutionId=FOREIGN&siteId=FOREIGN",
      { headers: { authorization: "Bearer forged" } },
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), adminCatalogFixture());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});
test("catalog BFF rejects inactive/non-exclusive/mismatched profiles before any business fetch", async () => {
  for (const profile of [
    null,
    { ...admission, active: false },
    { ...admission, id: "other" },
    ...[
      [],
      ["CLIENT"],
      ["WORKER"],
      ["SUPER_ADMIN"],
      ["ADMIN", "WORKER"],
      ["ADMIN", "ADMIN"],
    ].map((roles) => ({ ...admission, roles })),
  ]) {
    const response = await route({
      profile,
      fetchMock: () => assert.fail("No business call"),
    })();
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(
    (
      await route({
        auth: null,
        fetchMock: () => assert.fail("No business call"),
      })()
    ).status,
    401,
  );
});
test("catalog upstream errors are sanitized and only 503 gets bounded Retry-After", async () => {
  for (const [status, expected] of [
    [401, 401],
    [403, 403],
    [500, 500],
    [503, 503],
    [502, 503],
    [302, 502],
    [404, 502],
  ]) {
    const response = await route({
      fetchMock: async () =>
        Response.json(
          { message: "PRIVATE_SQL" },
          {
            status,
            headers: {
              "Retry-After": "9",
              "Set-Cookie": "PRIVATE",
              Location: "https://private.invalid",
            },
          },
        ),
    })();
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("retry-after"),
      expected === 503 ? "9" : null,
    );
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
  }
  for (const retry of ["0", "301", "9999", "tomorrow"]) {
    const response = await route({
      fetchMock: async () =>
        new Response(null, { status: 503, headers: { "Retry-After": retry } }),
    })();
    assert.equal(response.headers.get("retry-after"), "5");
  }
});
test("temporary Auth/network failure is recoverable 503 without clearing cookies", async () => {
  for (const options of [
    { authError: new TypeError("fetch failed PRIVATE") },
    { error: { status: 503, message: "PRIVATE" }, admissionStatus: 503 },
    {
      fetchMock: async () => {
        throw new TypeError("fetch failed PRIVATE");
      },
    },
  ]) {
    const response = await route(options)();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.doesNotMatch(await response.text(), /PRIVATE/);
  }
});
test("malformed upstream data is 502; body timeouts are 503; admission 401/403 preserved", async () => {
  for (const body of [{}, { products: [{}] }, null])
    assert.equal(
      (await route({ fetchMock: async () => Response.json(body) })()).status,
      502,
    );
  for (const status of [401, 403])
    assert.equal(
      (await route({ error: { status }, admissionStatus: status })()).status,
      status,
    );
  assert.equal(
    (
      await route({
        fetchMock: async () => ({
          status: 200,
          json: async () => {
            throw new DOMException("PRIVATE", "TimeoutError");
          },
        }),
      })()
    ).status,
    503,
  );
});
