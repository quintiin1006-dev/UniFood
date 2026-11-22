import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 7: /api/worker/daily-menu/today/... in the BFF (docs/propuesta-menu-dinamico.md 3.1, 4.1).

const CATEGORY = "00000000-0000-0000-0000-000000000051";
const OPTION = "00000000-0000-0000-0000-000000000052";
const ADDITION = "00000000-0000-0000-0000-000000000053";
const DAY = "2026-11-22";
const worker = {
  accessToken: "verified-session-token",
  profile: { id: "worker", active: true, roles: ["WORKER"] },
};
const today = {
  businessDate: DAY,
  version: 7,
  published: false,
  complete: false,
  missingCategories: ["Principio"],
  priceSet: true,
  title: "Almuerzo del día",
  price: "9500.00",
  publishedBy: "internal",
  categories: [
    {
      id: CATEGORY,
      label: "Proteína",
      kind: "SINGLE",
      canSkip: false,
      textUsed: 5,
      internal: "x",
      options: [{ id: OPTION, label: "Pollo", labelKey: "pollo" }],
    },
  ],
  additions: [
    {
      id: ADDITION,
      name: "Huevo frito",
      extraPrice: "2000.00",
      available: true,
    },
  ],
};

const UNSET = Symbol("unset");
function load({
  auth = worker,
  enabled = "true",
  status = 200,
  body = today,
  fetchError = null,
} = {}) {
  const calls = [];
  const environment = { API_URL: "http://backend.test:8080" };
  if (enabled !== UNSET) environment.MENU_DINAMICO_ENABLED = enabled;
  const loader = availabilityLoader({
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
  const root = "app/api/worker/daily-menu/today";
  return {
    calls,
    routes: {
      read: (request) => loader(`${root}/route.ts`).GET(request),
      options: (request, categoryId = CATEGORY) =>
        loader(`${root}/categories/[categoryId]/options/route.ts`).PUT(
          request,
          {
            params: Promise.resolve({ categoryId }),
          },
        ),
      addition: (request, additionId = ADDITION) =>
        loader(`${root}/additions/[additionId]/route.ts`).PUT(request, {
          params: Promise.resolve({ additionId }),
        }),
      copy: (request) =>
        loader(`${root}/copy-yesterday/route.ts`).POST(request),
      publish: (request) => loader(`${root}/publish/route.ts`).POST(request),
      unpublish: (request) =>
        loader(`${root}/unpublish/route.ts`).POST(request),
    },
  };
}

const URL_BASE = "http://browser.test/api/worker/daily-menu/today";
const read = (headers = {}) => new Request(URL_BASE, { headers });
const write = (
  body,
  {
    method = "POST",
    origin = "http://browser.test",
    day = DAY,
    headers = {},
  } = {},
) =>
  new Request(URL_BASE, {
    method,
    headers: {
      host: "browser.test",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(day ? { "X-Business-Date": day } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const WRITES = [
  [
    "options",
    { expectedVersion: 7, options: ["Arroz", "Lentejas"] },
    "PUT",
    `/categories/${CATEGORY}/options`,
  ],
  [
    "addition",
    { expectedVersion: 7, available: true },
    "PUT",
    `/additions/${ADDITION}`,
  ],
  ["copy", { expectedVersion: 7 }, "POST", "/copy-yesterday"],
  ["publish", { expectedVersion: 7 }, "POST", "/publish"],
  ["unpublish", { expectedVersion: 7 }, "POST", "/unpublish"],
];

test("with the flag off every route answers 404 and never calls Spring", async () => {
  for (const enabled of ["false", UNSET, "maybe"]) {
    const { calls, routes } = load({ enabled });
    const responses = [
      await routes.read(read()),
      ...(await Promise.all(
        WRITES.map(([name, body, method]) =>
          routes[name](write(body, { method })),
        ),
      )),
    ];
    for (const response of responses) {
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "DAILY_MENU_DISABLED");
    }
    assert.equal(calls.length, 0);
  }
});

test("without a session 401 and with another role 403, before Spring", async () => {
  for (const [auth, status] of [
    [null, 401],
    [{ ...worker, profile: { ...worker.profile, roles: ["CLIENT"] } }, 403],
    [{ ...worker, profile: { ...worker.profile, roles: ["ADMIN"] } }, 403],
    [
      { ...worker, profile: { ...worker.profile, roles: ["WORKER", "ADMIN"] } },
      403,
    ],
    [
      {
        ...worker,
        profile: { ...worker.profile, roles: ["WORKER", "CLIENT"] },
      },
      403,
    ],
  ]) {
    const { calls, routes } = load({ auth });
    assert.equal((await routes.read(read())).status, status);
    for (const [name, body, method] of WRITES)
      assert.equal(
        (await routes[name](write(body, { method }))).status,
        status,
        name,
      );
    assert.equal(calls.length, 0);
  }
});

test("every write needs the same origin", async () => {
  for (const origin of [null, "http://evil.test"]) {
    const { calls, routes } = load();
    for (const [name, body, method] of WRITES) {
      const response = await routes[name](write(body, { method, origin }));
      assert.equal(response.status, 403, `${name} ${origin}`);
    }
    assert.equal(calls.length, 0);
  }
});

test("invalid bodies, ids or business dates are refused before Spring", async () => {
  const cases = [
    ["options", { options: ["Arroz"] }],
    ["options", { expectedVersion: "7", options: ["Arroz"] }],
    ["options", { expectedVersion: -1, options: ["Arroz"] }],
    ["options", { expectedVersion: 7, options: "Arroz" }],
    ["options", { expectedVersion: 7, options: [1] }],
    ["options", { expectedVersion: 7, options: ["  "] }],
    ["options", { expectedVersion: 7, options: ["x".repeat(351)] }],
    ["options", { expectedVersion: 7, options: Array(21).fill("a") }],
    ["options", { expectedVersion: 7, options: ["Arroz"], price: "1.00" }],
    ["addition", { expectedVersion: 7 }],
    ["addition", { expectedVersion: 7, available: "true" }],
    ["addition", { expectedVersion: 7, available: true, extraPrice: "0.00" }],
    ["copy", {}],
    ["publish", { expectedVersion: 7.5 }],
    ["unpublish", { expectedVersion: 7, published: false }],
    ["publish", "{"],
    ["publish", "[]"],
  ];
  for (const [name, body] of cases) {
    const { calls, routes } = load();
    const method = name === "options" || name === "addition" ? "PUT" : "POST";
    const response = await routes[name](write(body, { method }));
    assert.equal(response.status, 400, `${name} ${JSON.stringify(body)}`);
    assert.equal((await response.json()).code, "DAILY_MENU_INVALID_REQUEST");
    assert.equal(calls.length, 0);
  }
  for (const day of [null, "22/11/2026"]) {
    const { calls, routes } = load();
    assert.equal(
      (await routes.publish(write({ expectedVersion: 7 }, { day }))).status,
      400,
    );
    assert.equal(calls.length, 0);
  }
  const { calls, routes } = load();
  assert.equal(
    (
      await routes.publish(
        write(
          { expectedVersion: 7 },
          { headers: { "content-type": "text/plain" } },
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (await routes.options(write(WRITES[0][1], { method: "PUT" }), "../x"))
      .status,
    404,
  );
  assert.equal(
    (await routes.addition(write(WRITES[1][1], { method: "PUT" }), "abc"))
      .status,
    409,
  );
  assert.equal(calls.length, 0);
});

test("writes reach Spring with the bearer, the day, a rebuilt body and safe fetch options", async () => {
  for (const [name, body, method, suffix] of WRITES) {
    const { calls, routes } = load();
    const response = await routes[name](
      write(body, {
        method,
        headers: { authorization: "Bearer forged", cookie: "sb=PRIVATE" },
      }),
    );
    assert.equal(response.status, 200, name);
    const [{ url, options }] = calls;
    assert.equal(
      url,
      `http://backend.test:8080/api/worker/daily-menu/today${suffix}`,
    );
    assert.equal(options.method, method);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, {
      authorization: "Bearer verified-session-token",
      accept: "application/json",
      "content-type": "application/json",
      "X-Business-Date": DAY,
    });
    assert.deepEqual(JSON.parse(options.body), body);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const { calls, routes } = load();
  await routes.read(read({ authorization: "Bearer forged" }));
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(
    calls[0].options.headers.authorization,
    "Bearer verified-session-token",
  );
});

test("only the published fields of the day leave the BFF", async () => {
  const { routes } = load();
  const body = await (await routes.read(read())).json();
  assert.deepEqual(body, {
    businessDate: DAY,
    version: 7,
    published: false,
    complete: false,
    missingCategories: ["Principio"],
    priceSet: true,
    title: "Almuerzo del día",
    price: "9500.00",
    categories: [
      {
        id: CATEGORY,
        label: "Proteína",
        kind: "SINGLE",
        canSkip: false,
        options: [{ id: OPTION, label: "Pollo" }],
        textUsed: 5,
      },
    ],
    additions: [
      {
        id: ADDITION,
        name: "Huevo frito",
        extraPrice: "2000.00",
        available: true,
      },
    ],
  });
  // copy-yesterday adds skippedCategories; a day without price keeps price null.
  const copied = load({
    body: {
      ...today,
      price: null,
      priceSet: false,
      skippedCategories: ["Proteína"],
    },
  });
  const copy = await (
    await copied.routes.copy(write({ expectedVersion: 7 }))
  ).json();
  assert.deepEqual(copy.skippedCategories, ["Proteína"]);
  assert.equal(copy.price, null);
  // A malformed day never reaches the browser.
  const broken = load({ body: { ...today, version: "7" } });
  assert.equal((await broken.routes.read(read())).status, 502);
});

test("backend errors become a code with its catalogue text, never raw text", async () => {
  const { BACKEND_ERROR_MESSAGES } = availabilityLoader()(
    "features/shared/messages.ts",
  );
  for (const [status, code] of [
    [409, "DAILY_MENU_VERSION_CONFLICT"],
    [409, "DAILY_MENU_DATE_CHANGED"],
    [409, "DAILY_MENU_INCOMPLETE"],
    [409, "DAILY_MENU_PRICE_NOT_SET"],
    [400, "DAILY_MENU_OPTION_DUPLICATED"],
    [400, "DAILY_MENU_TEXT_TOO_LONG"],
    [404, "DAILY_MENU_CATEGORY_NOT_FOUND"],
    [403, "DAILY_MENU_FORBIDDEN"],
  ]) {
    const { routes } = load({
      status,
      body: { code, message: "org.postgresql raw", trace: "x" },
    });
    const response = await routes.publish(write({ expectedVersion: 7 }));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(body, { code, message: BACKEND_ERROR_MESSAGES[code] });
  }
  const down = load({ fetchError: new TypeError("fetch failed") });
  const response = await down.routes.read(read());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).code,
    "DAILY_MENU_TEMPORARILY_UNAVAILABLE",
  );
  const broken = load({ status: 500, body: { message: "boom" } });
  assert.equal((await broken.routes.read(read())).status, 502);
});
