import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const root = "/api/super-admin/cafeterias";
const superAdmin = {
  profile: { active: true, roles: ["SUPER_ADMIN"] },
  accessToken: "verified-session-token",
};

function fixture() {
  return {
    institutions: [
      {
        id: "00000000-0000-0000-0000-0000000000a1",
        name: "Universidad Santo Tomás",
        active: true,
        sites: [
          {
            id: "00000000-0000-0000-0000-0000000000b1",
            name: "Sede Principal",
            city: "Villavicencio",
            active: true,
            cafeterias: [
              {
                id: "00000000-0000-0000-0000-0000000000c1",
                name: "Cafetería Central",
                subscribed: true,
                hasActiveAdmin: true,
              },
              {
                id: "00000000-0000-0000-0000-0000000000c2",
                name: "Cafetería Norte",
                subscribed: false,
                hasActiveAdmin: false,
              },
            ],
          },
          {
            id: "00000000-0000-0000-0000-0000000000b2",
            name: "Sede Vacía",
            city: "Villavicencio",
            active: false,
            cafeterias: [],
          },
        ],
      },
    ],
  };
}

function loader(fetchMock, auth = superAdmin, getAuth = async () => auth) {
  return availabilityLoader({
    fetchMock,
    mocks: { "@/features/auth/server/session": { getAuth } },
  });
}
function route(fetchMock, auth, getAuth) {
  const handler = loader(fetchMock, auth, getAuth)(`app${root}/route.ts`).GET;
  return (request = new Request(`http://localhost:3100${root}`)) =>
    handler(request);
}

test("SUPER_ADMIN BFF forwards only the session Bearer and returns the picked no-store DTO", async () => {
  const calls = [];
  const payload = fixture();
  payload.privateToken = "PRIVATE";
  payload.institutions[0].emailDomain = "PRIVATE";
  payload.institutions[0].sites[0].cafeterias[0].adminEmail = "PRIVATE";
  payload.institutions[0].sites[0].cafeterias[0].active = "PRIVATE";
  const response = await route(async (url, options) => {
    calls.push({ url, options });
    return Response.json(payload, { headers: { "set-cookie": "PRIVATE" } });
  })(
    new Request(`http://localhost:3100${root}?userId=FOREIGN&role=ADMIN`, {
      headers: { authorization: "Bearer forged", "x-user-id": "FOREIGN" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), fixture());
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

test("anonymous is 401 and CLIENT, WORKER, ADMIN, inactive or mixed roles are 403 before Spring", async () => {
  for (const [auth, status, code] of [
    [null, 401, "SUPER_ADMIN_UNAUTHORIZED"],
    [
      { ...superAdmin, profile: { active: false, roles: ["SUPER_ADMIN"] } },
      403,
      "SUPER_ADMIN_FORBIDDEN",
    ],
    ...[
      [],
      ["CLIENT"],
      ["WORKER"],
      ["ADMIN"],
      ["SUPER_ADMIN", "ADMIN"],
      ["SUPER_ADMIN", "WORKER"],
      ["SUPER_ADMIN", "CLIENT"],
      ["UNKNOWN"],
    ].map((roles) => [
      { ...superAdmin, profile: { active: true, roles } },
      403,
      "SUPER_ADMIN_FORBIDDEN",
    ]),
  ]) {
    const response = await route(
      async () => assert.fail("Must not reach Spring"),
      auth,
    )();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, code);
  }
});

test("a temporary session failure is a safe 503 without calling Spring", async () => {
  const unavailable = Object.assign(new Error("PRIVATE"), {
    code: "AUTH_TEMPORARILY_UNAVAILABLE",
  });
  const response = await route(
    async () => assert.fail("Must not reach Spring"),
    undefined,
    async () => {
      throw unavailable;
    },
  )();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "5");
  assert.ok(!(await response.text()).includes("PRIVATE"));
});

test("mutations on the shared transport require the same origin before reading the session", async () => {
  const { forwardSuperAdmin } = loader(
    async () => assert.fail("Must not reach Spring"),
    superAdmin,
    async () => assert.fail("Must not read the session"),
  )("features/super-admin/server/forward.ts");
  const options = { path: root, parse: (value) => value };
  for (const headers of [{}, { origin: "https://evil.example" }]) {
    const response = await forwardSuperAdmin(
      new Request(`http://localhost:3100${root}`, { method: "PATCH", headers }),
      options,
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "SUPER_ADMIN_FORBIDDEN");
  }
});

test("Spring errors keep 401/403 and never leak details, cookies or redirects", async () => {
  for (const [upstream, expected, code] of [
    [401, 401, "SUPER_ADMIN_UNAUTHORIZED"],
    [403, 403, "SUPER_ADMIN_FORBIDDEN"],
    [500, 500, "SUPER_ADMIN_INTERNAL_ERROR"],
    [503, 503, "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"],
    [502, 503, "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"],
    [404, 502, "SUPER_ADMIN_BAD_GATEWAY"],
    [302, 502, "SUPER_ADMIN_BAD_GATEWAY"],
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
    const body = await response.json();
    assert.equal(body.code, code);
    assert.ok(!JSON.stringify(body).includes("PRIVATE"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      response.headers.get("retry-after"),
      expected === 503 ? "9" : null,
    );
  }
});

test("malformed payloads, network failures and timeouts are 502/503, never a partial listing", async () => {
  const broken = [
    null,
    [],
    { institutions: "x" },
    { institutions: [{ ...fixture().institutions[0], id: "not-a-uuid" }] },
    {
      institutions: [
        {
          ...fixture().institutions[0],
          sites: [{ ...fixture().institutions[0].sites[0], active: "yes" }],
        },
      ],
    },
    {
      institutions: [
        {
          ...fixture().institutions[0],
          sites: [
            {
              ...fixture().institutions[0].sites[0],
              cafeterias: [{ id: "00000000-0000-0000-0000-0000000000c1" }],
            },
          ],
        },
      ],
    },
  ];
  for (const payload of broken) {
    const response = await route(async () => Response.json(payload))();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "SUPER_ADMIN_BAD_GATEWAY");
  }
  const invalidJson = await route(
    async () => new Response("<html>", { status: 200 }),
  )();
  assert.equal(invalidJson.status, 502);
  for (const failure of [
    new TypeError("fetch failed PRIVATE"),
    Object.assign(new Error("PRIVATE"), { name: "TimeoutError" }),
  ]) {
    const response = await route(async () => {
      throw failure;
    })();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.ok(!(await response.text()).includes("PRIVATE"));
  }
});
