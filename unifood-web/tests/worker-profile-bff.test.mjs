import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import {
  workerProfileBusinessFixture,
  workerProfileFixture,
} from "./helpers/worker-profile-fixture.mjs";
const identity = {
  id: "verified-subject",
  email: "worker@example.invalid",
  accessToken: "verified-token",
};
const admission = {
  id: identity.id,
  active: true,
  roles: ["WORKER"],
  email: "untrusted-business@example.invalid",
};
function route({
  fetchMock = async () => Response.json(workerProfileBusinessFixture()),
  auth = identity,
  profile = admission,
  error = null,
  authError = null,
  admissionStatus = undefined,
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
  })("app/api/worker/profile/route.ts").GET;
}
test("BFF uses Auth email and verified bearer, fixed route, timeout, blocked redirects and no-store", async () => {
  let calls = 0;
  const upstream = {
    ...workerProfileBusinessFixture(),
    email: "forged-backend@example.invalid",
    id: "PRIVATE",
    fullName: "PRIVATE",
  };
  upstream.cafeteria.id = "PRIVATE";
  const response = await route({
    fetchMock: async (url, options) => {
      calls++;
      assert.equal(url, "http://backend.test:8080/api/worker/profile");
      assert.deepEqual(options.headers, {
        authorization: "Bearer verified-token",
        accept: "application/json",
      });
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(upstream, { headers: { "set-cookie": "PRIVATE" } });
    },
  })(
    new Request(
      "http://browser/api/worker/profile?userId=FOREIGN&email=forged@browser.invalid&cafeteriaId=FOREIGN&siteId=FOREIGN&institutionId=FOREIGN",
      { headers: { authorization: "Bearer forged" } },
    ),
  );
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), workerProfileFixture());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});
test("verified but inactive/non-exclusive roles and wrong RPC subject are 403, never 401", async () => {
  for (const profile of [
    null,
    { ...admission, active: false },
    { ...admission, id: "foreign" },
    ...[
      [],
      ["CLIENT"],
      ["ADMIN"],
      ["SUPER_ADMIN"],
      ["WORKER", "ADMIN"],
      ["WORKER", "WORKER"],
    ].map((roles) => ({ ...admission, roles })),
  ]) {
    const response = await route({
      profile,
      fetchMock: () => assert.fail("No Spring read"),
    })();
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("genuinely missing identity and invalid provider emails are 401 before Spring", async () => {
  for (const auth of [
    null,
    ...["", " ", "bad-email", " x@y.invalid", 42, null].map((email) => ({
      ...identity,
      email,
    })),
  ])
    assert.equal(
      (await route({ auth, fetchMock: () => assert.fail("No Spring read") })())
        .status,
      401,
    );
});
test("upstream denial/500/503/redirects stay safe and Retry-After is bounded", async () => {
  for (const [upstream, expected] of [
    [401, 401],
    [403, 403],
    [500, 500],
    [503, 503],
    [302, 502],
    [404, 502],
    [502, 503],
  ]) {
    const response = await route({
      fetchMock: async () =>
        Response.json(
          { message: "PRIVATE_SQL_DETAIL" },
          {
            status: upstream,
            headers: {
              "retry-after": "9",
              "set-cookie": "PRIVATE",
              location: "https://private.invalid",
            },
          },
        ),
    })();
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes("PRIVATE"));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      response.headers.get("retry-after"),
      expected === 503 ? "9" : null,
    );
  }
  for (const retry of ["0", "301", "9999", "garbage", "-1"])
    assert.equal(
      (
        await route({
          fetchMock: async () =>
            new Response(null, {
              status: 503,
              headers: { "Retry-After": retry },
            }),
        })()
      ).headers.get("retry-after"),
      "5",
    );
});
test("temporary Auth/RPC/transport/body errors return recoverable 503 with no cookie clearing", async () => {
  const cases = [
    {
      authError: Object.assign(new Error("PRIVATE"), {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
      }),
    },
    { error: { status: 503, message: "PRIVATE" } },
    {
      fetchMock: async () => {
        throw new TypeError("PRIVATE");
      },
    },
    {
      fetchMock: async () => {
        throw new DOMException("PRIVATE", "TimeoutError");
      },
    },
    {
      fetchMock: async () => ({
        status: 200,
        json: async () => {
          throw new DOMException("PRIVATE", "AbortError");
        },
      }),
    },
  ];
  for (const config of cases) {
    const response = await route(config)();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!(await response.text()).includes("PRIVATE"));
  }
  assert.equal((await route()()).status, 200);
});
test("invalid Spring payloads fail completely with 502, inactive cafeteria remains readable", async () => {
  for (const body of [
    null,
    {},
    [],
    { ...workerProfileBusinessFixture(), role: "ADMIN" },
    {
      ...workerProfileBusinessFixture(),
      cafeteria: { name: "Cafe", active: "false" },
    },
    { ...workerProfileBusinessFixture(), site: { name: " " } },
  ])
    assert.equal(
      (await route({ fetchMock: async () => Response.json(body) })()).status,
      502,
    );
  assert.equal(
    (await route({ fetchMock: async () => new Response("PRIVATE HTML") })())
      .status,
    502,
  );
  const body = workerProfileBusinessFixture();
  body.cafeteria.active = false;
  const result = await route({ fetchMock: async () => Response.json(body) })();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).cafeteria.active, false);
});
test("identity rendering signals propagate without replacing Next behavior", async () => {
  const signal = Object.assign(new Error("dynamic"), {
    digest: "DYNAMIC_SERVER_USAGE",
  });
  await assert.rejects(route({ authError: signal })(), (e) => e === signal);
});

test("RPC authentication and permission rejections keep their distinct status", async () => {
  for (const admissionStatus of [401, 403]) {
    const response = await route({
      admissionStatus,
      error: { code: "PROVIDER_REJECTION", message: "PRIVATE" },
      fetchMock: () => assert.fail("Admission failure must not reach Spring"),
    })();
    assert.equal(response.status, admissionStatus);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});
