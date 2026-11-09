import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const CAFETERIA = "00000000-0000-0000-0000-000000000031";
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const menu = {
  cafeteria: { id: CAFETERIA, name: "Cafetería Central", open: true },
  businessDate: "2026-11-20",
  categories: [],
};

function routes({ auth = client, fetchMock, authError = null } = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchMock) return fetchMock(url, options);
      return Response.json(menu, {
        headers: {
          etag: '"abc"',
          "cache-control": "no-cache, private",
          "set-cookie": "PRIVATE=1",
          "x-internal": "PRIVATE",
        },
      });
    },
    mocks: {
      "@/features/auth/server/session": {
        getAuth: async () => {
          if (authError) throw authError;
          return auth;
        },
      },
    },
  });
  return {
    calls,
    context: load("app/api/me/context/route.ts").GET,
    menu: load("app/api/me/menu/route.ts").GET,
  };
}
const request = (path, headers = {}) =>
  new Request(`http://browser.test${path}`, { headers });

test("without a session both routes answer 401 and never call Spring", async () => {
  const { calls, context, menu: getMenu } = routes({ auth: null });
  for (const response of [
    await context(request("/api/me/context")),
    await getMenu(request(`/api/me/menu?cafeteriaId=${CAFETERIA}`)),
  ]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).message, "Sesión no válida.");
  }
  assert.equal(calls.length, 0);
});

test("non-client roles are refused before Spring", async () => {
  for (const roles of [["WORKER"], ["ADMIN"], ["SUPER_ADMIN"], []]) {
    const { calls, context } = routes({
      auth: { ...client, profile: { ...client.profile, roles } },
    });
    assert.equal((await context(request("/api/me/context"))).status, 403);
    assert.equal(calls.length, 0, roles.join());
  }
});

test("the bearer comes from the session; a browser Authorization and query are ignored", async () => {
  const { calls, context } = routes();
  const response = await context(
    request("/api/me/context?institutionId=FOREIGN&userId=FOREIGN", {
      authorization: "Bearer forged-by-browser",
      cookie: "sb-x-auth-token=PRIVATE",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://backend.test:8080/api/me/context");
  assert.deepEqual(calls[0].options.headers, {
    authorization: "Bearer verified-session-token",
    accept: "application/json",
  });
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("menu forwards only a valid cafeteria id and keeps ETag and Cache-Control", async () => {
  const { calls, menu: getMenu } = routes();
  for (const bad of [
    "",
    "?cafeteriaId=",
    "?cafeteriaId=not-a-uuid",
    "?cafeteriaId=1;DROP",
  ]) {
    const response = await getMenu(request(`/api/me/menu${bad}`));
    assert.equal(response.status, 400, bad);
    assert.equal(
      (await response.json()).message,
      "Selecciona una cafetería válida.",
    );
  }
  assert.equal(calls.length, 0);
  const response = await getMenu(
    request(`/api/me/menu?cafeteriaId=${CAFETERIA}&institutionId=FOREIGN`),
  );
  assert.equal(response.status, 200);
  assert.equal(
    calls[0].url,
    `http://backend.test:8080/api/me/menu?cafeteriaId=${CAFETERIA}`,
  );
  assert.equal(response.headers.get("etag"), '"abc"');
  assert.equal(response.headers.get("cache-control"), "no-cache, private");
  // Internal and cookie headers never cross the BFF.
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-internal"), null);
  assert.deepEqual(await response.json(), menu);
});

test("If-None-Match reaches Spring and a 304 comes back empty with its ETag", async () => {
  const { calls, menu: getMenu } = routes({
    fetchMock: async () =>
      new Response(null, {
        status: 304,
        headers: { etag: '"abc"', "cache-control": "no-cache, private" },
      }),
  });
  const response = await getMenu(
    request(`/api/me/menu?cafeteriaId=${CAFETERIA}`, {
      "if-none-match": '"abc"',
    }),
  );
  assert.equal(calls[0].options.headers["if-none-match"], '"abc"');
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), '"abc"');
  assert.equal(await response.text(), "");
});

test("Spring's safe errors keep their status, code and message", async () => {
  for (const [status, code, message] of [
    [404, "CAFETERIA_NOT_FOUND", "No encontramos esa cafetería."],
    [
      403,
      "CAFETERIA_NOT_SUBSCRIBED",
      "Esta cafetería no está disponible en UniFood.",
    ],
    [404, "CLIENT_PROFILE_NOT_FOUND", "No se encontró el perfil de tu cuenta."],
    [
      503,
      "CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE",
      "No pudimos cargar el menú en este momento. Inténtalo nuevamente.",
    ],
  ]) {
    const { menu: getMenu } = routes({
      fetchMock: async () =>
        Response.json(
          { status, code, message, timestamp: "t", path: "/api/me/menu" },
          {
            status,
            headers: {
              "cache-control": "no-store",
              ...(status === 503 ? { "retry-after": "5" } : {}),
            },
          },
        ),
    });
    const response = await getMenu(
      request(`/api/me/menu?cafeteriaId=${CAFETERIA}`),
    );
    assert.equal(response.status, status, code);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.message, message);
    if (status === 503) assert.equal(response.headers.get("retry-after"), "5");
  }
});

test("unexpected backend failures become a generic 502 without internal details", async () => {
  for (const fetchMock of [
    async () => {
      throw new TypeError("PRIVATE connect ECONNREFUSED 10.0.0.1");
    },
    async () => new Response("PRIVATE stack trace", { status: 500 }),
    async () => Response.json({ message: "PRIVATE detail" }, { status: 500 }),
    async () => new Response("<html>PRIVATE</html>", { status: 200 }),
  ]) {
    const { context } = routes({ fetchMock });
    const response = await context(request("/api/me/context"));
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal(text.includes("PRIVATE"), false);
  }
});

test("a temporary auth outage answers 503 instead of an anonymous 401", async () => {
  const outage = Object.assign(new Error("down"), {
    code: "AUTH_TEMPORARILY_UNAVAILABLE",
  });
  const { calls, context } = routes({ authError: outage });
  const response = await context(request("/api/me/context"));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});
