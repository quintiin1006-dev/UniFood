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
                visible: true,
                hasActiveAdmin: true,
                billing: {
                  model: "SUBSCRIPTION",
                  perOrderFeeCop: null,
                  subscriptionFeeCop: 250000,
                  version: 2,
                },
              },
              {
                id: "00000000-0000-0000-0000-0000000000c2",
                name: "Cafetería Norte",
                visible: false,
                hasActiveAdmin: false,
                billing: {
                  model: "NONE",
                  perOrderFeeCop: null,
                  subscriptionFeeCop: null,
                  version: 0,
                },
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

function withCafeteria(cafeteria) {
  const payload = fixture();
  payload.institutions[0].sites[0].cafeterias = [cafeteria];
  return payload;
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
  payload.institutions[0].sites[0].cafeterias[0].subscribed = "PRIVATE";
  payload.institutions[0].sites[0].cafeterias[0].billing.updatedBy = "PRIVATE";
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
    // The old field alone is no longer a valid cafeteria.
    withCafeteria({
      id: "00000000-0000-0000-0000-0000000000c1",
      name: "Cafetería Central",
      subscribed: true,
      hasActiveAdmin: true,
    }),
    // A fee that breaks the 022 rules is not shown as if it were valid.
    withCafeteria({
      ...fixture().institutions[0].sites[0].cafeterias[0],
      billing: {
        model: "NONE",
        perOrderFeeCop: 1000,
        subscriptionFeeCop: null,
        version: 0,
      },
    }),
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

// ---------------------------------------------------------------- visibility, billing, audit

const CAFE = "00000000-0000-0000-0000-0000000000c1";
const updated = () => fixture().institutions[0].sites[0].cafeterias[0];

function command(name, fetchMock, auth, getAuth) {
  const methods = { visibility: "PATCH", billing: "PUT", audit: "GET" };
  const handler = loader(
    fetchMock,
    auth,
    getAuth,
  )(`app${root}/[cafeteriaId]/${name}/route.ts`)[methods[name]];
  return (body, { id = CAFE, headers = {}, raw } = {}) =>
    handler(
      new Request(`http://localhost:3100${root}/${id}/${name}?limit=500`, {
        method: methods[name],
        headers: {
          origin: "http://localhost:3100",
          ...(methods[name] === "GET"
            ? {}
            : { "content-type": "application/json" }),
          ...headers,
        },
        ...(methods[name] === "GET"
          ? {}
          : { body: raw ?? JSON.stringify(body) }),
      }),
      { params: Promise.resolve({ cafeteriaId: id }) },
    );
}

const BILLING = {
  model: "PER_ORDER_FEE",
  perOrderFeeCop: 1000,
  subscriptionFeeCop: null,
  expectedVersion: 2,
};

test("visibility and billing forward only the validated body with the session Bearer", async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ...updated(), PRIVATE: "x" });
  };
  const visibility = await command(
    "visibility",
    fetchMock,
  )({
    visible: false,
    expectedVisible: true,
  });
  assert.equal(visibility.status, 200);
  assert.deepEqual(await visibility.json(), updated());
  assert.equal(visibility.headers.get("cache-control"), "no-store");
  const billing = await command("billing", fetchMock)(BILLING);
  assert.equal(billing.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    `http://backend.test:8080${root}/${CAFE}/visibility`,
  );
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(
    calls[0].options.body,
    JSON.stringify({ visible: false, expectedVisible: true }),
  );
  assert.equal(calls[1].url, `http://backend.test:8080${root}/${CAFE}/billing`);
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].options.body), BILLING);
  for (const call of calls) {
    assert.deepEqual(call.options.headers, {
      authorization: "Bearer verified-session-token",
      accept: "application/json",
      "content-type": "application/json",
    });
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.redirect, "error");
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test("the audit always asks Spring for the 20 most recent, whatever the browser sends", async () => {
  const calls = [];
  const response = await command("audit", async (url) => {
    calls.push(url);
    return Response.json({
      entries: [
        {
          setting: "BILLING",
          oldValue: {},
          newValue: {
            model: "NONE",
            perOrderFeeCop: null,
            subscriptionFeeCop: null,
          },
          changedAt: "2026-11-12T15:00:00Z",
          changedBy: null,
          source: "SQL",
          email: "PRIVATE",
        },
        {
          setting: "VISIBILITY",
          oldValue: { visible: true },
          newValue: { visible: false },
          changedAt: "2026-11-12T16:00:00Z",
          changedBy: { name: "Dueño", email: "PRIVATE" },
          source: "API",
        },
      ],
    });
  })();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    `http://backend.test:8080${root}/${CAFE}/audit?limit=20`,
  ]);
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes("PRIVATE"));
  assert.equal(body.entries[0].oldValue, null);
  assert.deepEqual(body.entries[1].changedBy, { name: "Dueño" });
  // The browser parses the BFF payload again: the same contract must accept it.
  const { parseCafeteriaAudit } = loader(async () => null)(
    "features/super-admin/contracts.ts",
  );
  assert.deepEqual(parseCafeteriaAudit(body), body);
});

test("mutations need the same origin, a session and SUPER_ADMIN before anything else", async () => {
  for (const name of ["visibility", "billing"]) {
    const body =
      name === "billing" ? BILLING : { visible: false, expectedVisible: true };
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "" },
    ]) {
      const response = await command(
        name,
        async () => assert.fail("Must not reach Spring"),
        superAdmin,
        async () => assert.fail("Must not read the session"),
      )(body, { headers });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "SUPER_ADMIN_FORBIDDEN");
    }
    for (const [auth, status] of [
      [null, 401],
      [{ ...superAdmin, profile: { active: true, roles: ["ADMIN"] } }, 403],
      [
        { ...superAdmin, profile: { active: false, roles: ["SUPER_ADMIN"] } },
        403,
      ],
    ]) {
      const response = await command(
        name,
        async () => assert.fail("Must not reach Spring"),
        auth,
      )(body);
      assert.equal(response.status, status);
    }
  }
});

test("bodies with other keys, types or amounts are a fixed 400 without calling Spring", async () => {
  const never = async () => assert.fail("Must not reach Spring");
  for (const body of [
    {},
    { visible: false },
    { visible: "false", expectedVisible: true },
    { visible: false, expectedVisible: true, cafeteriaId: CAFE },
    [],
    null,
  ]) {
    const response = await command("visibility", never)(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "SUPER_ADMIN_INVALID_REQUEST");
  }
  for (const body of [
    { ...BILLING, perOrderFeeCop: null },
    { ...BILLING, perOrderFeeCop: 0 },
    { ...BILLING, perOrderFeeCop: 1000001 },
    { ...BILLING, perOrderFeeCop: 1000.5 },
    { ...BILLING, perOrderFeeCop: "1000" },
    { ...BILLING, subscriptionFeeCop: 50000 },
    { ...BILLING, model: "NONE" },
    {
      ...BILLING,
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 0,
    },
    {
      ...BILLING,
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 100000001,
    },
    { ...BILLING, model: "PERCENT" },
    { ...BILLING, expectedVersion: -1 },
    { ...BILLING, expectedVersion: "2" },
    { ...BILLING, extra: true },
    { model: "NONE", perOrderFeeCop: null, expectedVersion: 0 },
  ]) {
    const response = await command("billing", never)(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    const problem = await response.json();
    assert.equal(problem.code, "BILLING_INVALID_REQUEST");
    assert.equal(
      problem.message,
      "Revisa el modelo de cobro y sus montos en pesos enteros.",
    );
  }
  for (const [raw, headers] of [
    ["{not json", {}],
    [JSON.stringify(BILLING), { "content-type": "text/plain" }],
    [JSON.stringify({ ...BILLING, pad: "x".repeat(2000) }), {}],
  ]) {
    const response = await command("billing", never)(undefined, {
      raw,
      headers,
    });
    assert.equal(response.status, 400);
  }
  const badId = await command("visibility", never)(
    { visible: false, expectedVisible: true },
    { id: "../orders" },
  );
  assert.equal(badId.status, 400);
});

test("Spring's business outcomes keep their code; anything else is a fixed save failure", async () => {
  for (const [upstream, code, expected, expectedCode] of [
    [409, "VISIBILITY_STATE_CHANGED", 409, "VISIBILITY_STATE_CHANGED"],
    [409, "CAFETERIA_REQUIRES_ADMIN", 409, "CAFETERIA_REQUIRES_ADMIN"],
    [409, "PRIVATE", 502, "SUPER_ADMIN_BAD_GATEWAY"],
    [404, "CAFETERIA_NOT_FOUND", 404, "CAFETERIA_NOT_FOUND"],
    [400, "BILLING_INVALID_REQUEST", 400, "BILLING_INVALID_REQUEST"],
    [403, "PRIVATE", 403, "SUPER_ADMIN_FORBIDDEN"],
    [503, "PRIVATE", 503, "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"],
    [502, "PRIVATE", 503, "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"],
    [302, "PRIVATE", 502, "SUPER_ADMIN_BAD_GATEWAY"],
  ]) {
    const response = await command("visibility", async () =>
      Response.json(
        { code, message: "SQL PRIVATE" },
        { status: upstream, headers: { "set-cookie": "PRIVATE" } },
      ),
    )({ visible: false, expectedVisible: true });
    assert.equal(response.status, expected, `${upstream} ${code}`);
    const body = await response.json();
    assert.equal(body.code, expectedCode);
    assert.ok(!JSON.stringify(body).includes("PRIVATE"));
    assert.equal(response.headers.get("set-cookie"), null);
    if ([502, 503].includes(expected))
      assert.equal(
        body.message,
        "No pudimos guardar el cambio. Inténtalo de nuevo.",
      );
  }
  const stale = await command("billing", async () =>
    Response.json({ code: "BILLING_STATE_CHANGED" }, { status: 409 }),
  )(BILLING);
  assert.equal(
    (await stale.json()).message,
    "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.",
  );
  const timeout = await command("billing", async () => {
    throw Object.assign(new Error("PRIVATE"), { name: "TimeoutError" });
  })(BILLING);
  assert.equal(timeout.status, 503);
  assert.equal(timeout.headers.get("retry-after"), "5");
  const malformed = await command("billing", async () =>
    Response.json({ ...updated(), visible: "yes" }),
  )(BILLING);
  assert.equal(malformed.status, 502);
});
