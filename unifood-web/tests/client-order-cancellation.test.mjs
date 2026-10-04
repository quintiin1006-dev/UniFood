import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function load(file, environment, fetchMock, mocks = {}, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", "process", "fetch", source)(
    (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      const dependency = name.startsWith("@/")
        ? path.resolve(`${name.slice(2)}.ts`)
        : path.resolve(path.dirname(resolved), `${name}.ts`);
      return load(dependency, environment, fetchMock, mocks, cache);
    },
    mod,
    mod.exports,
    { env: environment },
    fetchMock,
  );
  return mod.exports;
}

const orderId = "00000000-0000-0000-0000-000000000010";
const client = {
  profile: { id: "authenticated-user", active: true, roles: ["CLIENT"] },
  accessToken: "verified-session-token",
};
function route(fetchMock, auth = client) {
  return load(
    "app/api/me/orders/[orderId]/cancel/route.ts",
    { API_URL: "http://backend.test:8080" },
    fetchMock,
    {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  );
}
function cancel(
  handler,
  { id = orderId, origin = "http://localhost:3100" } = {},
) {
  return handler.PATCH(
    new Request(
      `http://localhost:3100/api/me/orders/${id}/cancel?userId=forged&clientId=forged&email=other@example.invalid`,
      {
        method: "PATCH",
        headers: {
          origin,
          authorization: "Bearer forged-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "forged",
          clientId: "forged",
          accessToken: "forged-token",
        }),
      },
    ),
    { params: Promise.resolve({ orderId: id }) },
  );
}

test("client cancellation forwards only the verified token and returns a safe acknowledgement", async () => {
  const calls = [];
  const response = await cancel(
    route(async (url, options) => {
      calls.push([String(url), options]);
      return Response.json(
        {
          id: orderId,
          status: "CANCELLED",
          accessToken: "provider-secret",
          clientDocument: "private-document",
        },
        { headers: { "set-cookie": "provider-secret" } },
      );
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: orderId, status: "CANCELLED" });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, `http://backend.test:8080/api/me/orders/${orderId}/cancel`);
  assert.equal(options.method, "PATCH");
  assert.deepEqual(options.headers, {
    authorization: "Bearer verified-session-token",
  });
  assert.equal(options.body, undefined);
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
});

test("anonymous, inactive, non-client and mixed-role accounts never reach the backend", async () => {
  for (const [auth, expected] of [
    [null, 401],
    [{ ...client, profile: { ...client.profile, active: false } }, 403],
    ...[
      [],
      ["WORKER"],
      ["ADMIN"],
      ["SUPER_ADMIN"],
      ["CLIENT", "WORKER"],
      ["CLIENT", "ADMIN"],
      ["CLIENT", "SUPER_ADMIN"],
    ].map((roles) => [
      { ...client, profile: { ...client.profile, roles } },
      403,
    ]),
  ]) {
    let calls = 0;
    const response = await cancel(
      route(async () => {
        calls++;
        throw Error("unexpected backend call");
      }, auth),
    );
    assert.equal(response.status, expected);
    assert.equal(calls, 0);
  }
});

test("invalid origin and path cannot forward client cancellation", async () => {
  let calls = 0;
  const handler = route(async () => {
    calls++;
    throw Error("unexpected backend call");
  });
  assert.equal(
    (await cancel(handler, { origin: "http://attacker.invalid" })).status,
    403,
  );
  assert.equal((await cancel(handler, { origin: "" })).status, 403);
  assert.equal((await cancel(handler, { id: "invalid-path" })).status, 400);
  assert.equal(calls, 0);
});

test("upstream errors keep public statuses but discard bodies and sensitive headers", async () => {
  for (const upstream of [400, 401, 403, 404, 409, 500, 302, 201]) {
    const response = await cancel(
      route(
        async () =>
          new Response("provider-secret verified-session-token forged-token", {
            status: upstream,
            headers: {
              authorization: "provider-secret",
              "set-cookie": "provider-secret",
            },
          }),
      ),
    );
    assert.equal(
      response.status,
      [400, 401, 403, 404, 409].includes(upstream) ? upstream : 502,
    );
    const body = await response.json();
    assert.equal(body.status, response.status);
    assert.ok(body.code);
    assert.ok(body.timestamp);
    assert.equal(body.path, `/api/me/orders/${orderId}/cancel`);
    assert.ok(!JSON.stringify(body).includes("provider-secret"));
    assert.ok(!JSON.stringify(body).includes("verified-session-token"));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("authorization"), null);
  }
});

test("foreign, unlinked and missing orders expose the same sanitized 404", async () => {
  const bodies = [];
  for (const detail of ["foreign owner", "unlinked client", "missing order"]) {
    const response = await cancel(
      route(async () =>
        Response.json(
          { code: "ORDER_NOT_FOUND", message: `${detail} provider-secret` },
          { status: 404 },
        ),
      ),
    );
    assert.equal(response.status, 404);
    const { timestamp, ...body } = await response.json();
    assert.ok(timestamp);
    assert.equal(body.code, "ORDER_NOT_FOUND");
    assert.equal(body.status, 404);
    assert.ok(!JSON.stringify(body).includes(detail));
    assert.ok(!JSON.stringify(body).includes("provider-secret"));
    bodies.push(body);
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], bodies[2]);
});

test("malformed success and network failures become a safe gateway error", async () => {
  for (const makeResponse of [
    () =>
      Response.json({
        id: orderId,
        status: "PENDING",
        token: "provider-secret",
      }),
    () => Response.json({ id: "foreign-order", status: "CANCELLED" }),
    () => Response.json(null),
    () => Response.json({ id: 1, status: "CANCELLED" }),
    () => new Response("provider-secret"),
    () => {
      throw Error("provider-secret");
    },
  ]) {
    const response = await cancel(route(async () => makeResponse()));
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("provider-secret"));
  }
});

test("a refreshed profile denies a revoked client on the next request", async () => {
  let current = client;
  let calls = 0;
  const handler = load(
    "app/api/me/orders/[orderId]/cancel/route.ts",
    { API_URL: "http://backend.test:8080" },
    async () => {
      calls++;
      return Response.json({ id: orderId, status: "CANCELLED" });
    },
    { "@/features/auth/server/session": { getAuth: async () => current } },
  );
  assert.equal((await cancel(handler)).status, 200);
  current = { ...client, profile: { ...client.profile, roles: [] } };
  assert.equal((await cancel(handler)).status, 403);
  current = { ...client, profile: { ...client.profile, active: false } };
  assert.equal((await cancel(handler)).status, 403);
  assert.equal(calls, 1);
});
