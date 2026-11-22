import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 5: GET /api/me/daily-menu in the BFF (docs/propuesta-menu-dinamico.md 4.1).

const CAFETERIA = "00000000-0000-0000-0000-000000000031";
const OPTION = "00000000-0000-0000-0000-000000000041";
const CATEGORY = "00000000-0000-0000-0000-000000000051";
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const menu = {
  cafeteria: { id: CAFETERIA, name: "Central", open: true },
  businessDate: "2026-11-21",
  title: "Almuerzo del día",
  price: "9500.00",
  version: 7,
  publishedBy: "worker-id",
  categories: [
    {
      id: CATEGORY,
      label: "Proteína",
      kind: "SINGLE",
      canSkip: false,
      textUsed: 5,
      options: [{ id: OPTION, label: "Pollo", internal: "x" }],
    },
  ],
};

const UNSET = Symbol("unset");
function route({
  auth = client,
  enabled = "true",
  status = 200,
  body = menu,
  contentType = "application/json",
  fetchError = null,
} = {}) {
  const calls = [];
  const environment = { API_URL: "http://backend.test:8080" };
  if (enabled !== UNSET) environment.MENU_DINAMICO_ENABLED = enabled;
  const load = availabilityLoader({
    environment,
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchError) throw fetchError;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": contentType, "set-cookie": "PRIVATE=1" },
      });
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return { calls, GET: load("app/api/me/daily-menu/route.ts").GET };
}
const request = (query = `?cafeteriaId=${CAFETERIA}`, headers = {}) =>
  new Request(`http://browser.test/api/me/daily-menu${query}`, { headers });

test("with the flag off (or unset, or malformed) it answers 404 and never calls Spring", async () => {
  for (const enabled of ["false", UNSET, "maybe", ""]) {
    const { calls, GET } = route({ enabled });
    const response = await GET(request());
    assert.equal(response.status, 404, String(enabled));
    assert.equal((await response.json()).code, "DAILY_MENU_DISABLED");
    assert.equal(calls.length, 0);
  }
});

test("without a session 401, a non-client role 403, before Spring", async () => {
  const anonymous = route({ auth: null });
  assert.equal((await anonymous.GET(request())).status, 401);
  assert.equal(anonymous.calls.length, 0);
  for (const roles of [["WORKER"], ["ADMIN"], ["SUPER_ADMIN"], []]) {
    const { calls, GET } = route({
      auth: { ...client, profile: { ...client.profile, roles } },
    });
    const response = await GET(request());
    assert.equal(response.status, 403, roles.join());
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
  }
});

test("an invalid cafeteria id is refused before Spring", async () => {
  for (const query of [
    "",
    "?cafeteriaId=",
    "?cafeteriaId=abc",
    "?cafeteriaId=../x",
  ]) {
    const { calls, GET } = route();
    assert.equal((await GET(request(query))).status, 400, query);
    assert.equal(calls.length, 0);
  }
});

test("the fetch uses the session bearer, no-store, redirect error and a timeout", async () => {
  const { calls, GET } = route();
  const response = await GET(
    request(`?cafeteriaId=${CAFETERIA}`, {
      authorization: "Bearer forged",
      cookie: "sb=PRIVATE",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(
    url,
    `http://backend.test:8080/api/me/daily-menu?cafeteriaId=${CAFETERIA}`,
  );
  assert.equal(options.headers.authorization, "Bearer verified-session-token");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("only the published contract fields leave the BFF", async () => {
  const { GET } = route();
  const body = await (await GET(request())).json();
  assert.deepEqual(body, {
    cafeteria: { id: CAFETERIA, name: "Central", open: true },
    businessDate: "2026-11-21",
    title: "Almuerzo del día",
    price: "9500.00",
    categories: [
      {
        id: CATEGORY,
        label: "Proteína",
        kind: "SINGLE",
        canSkip: false,
        options: [{ id: OPTION, label: "Pollo" }],
      },
    ],
  });
});

test("backend errors are translated with the catalogue, never passed raw", async () => {
  const { BACKEND_ERROR_MESSAGES } = availabilityLoader()(
    "features/shared/messages.ts",
  );
  const notPublished = route({
    status: 404,
    body: { code: "DAILY_MENU_NOT_PUBLISHED", message: "Spring internal text" },
  });
  const response = await notPublished.GET(request());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "DAILY_MENU_NOT_PUBLISHED",
    message: BACKEND_ERROR_MESSAGES.DAILY_MENU_NOT_PUBLISHED,
  });

  for (const options of [
    { status: 500, body: { message: "stack trace" } },
    { status: 200, body: { ...menu, price: 9500 } },
    {
      status: 200,
      body: { ...menu, cafeteria: { ...menu.cafeteria, id: OPTION } },
    },
    { status: 200, contentType: "text/html" },
    { fetchError: new Error("ECONNREFUSED") },
  ]) {
    const { GET } = route(options);
    const failed = await GET(request());
    assert.equal(failed.status, 502, JSON.stringify(options));
    const text = JSON.stringify(await failed.json());
    assert.doesNotMatch(text, /stack|ECONNREFUSED|Spring/);
  }
});

test("GET /api/me/menu drops dailyMenu with the web flag off and keeps it with the flag on", async () => {
  const catalog = {
    cafeteria: { id: CAFETERIA, name: "Central", open: true },
    businessDate: "2026-11-21",
    categories: [],
    dailyMenu: { available: true },
  };
  for (const [enabled, expected] of [
    ["true", true],
    ["false", false],
    [UNSET, false],
  ]) {
    const environment = { API_URL: "http://backend.test:8080" };
    if (enabled !== UNSET) environment.MENU_DINAMICO_ENABLED = enabled;
    const GET = availabilityLoader({
      environment,
      fetchMock: async () => Response.json(catalog),
      mocks: {
        "@/features/auth/server/session": { getAuth: async () => client },
      },
    })("app/api/me/menu/route.ts").GET;
    const body = await (
      await GET(
        new Request(`http://browser.test/api/me/menu?cafeteriaId=${CAFETERIA}`),
      )
    ).json();
    assert.equal("dailyMenu" in body, expected, String(enabled));
    assert.deepEqual(body.categories, []);
  }
});
