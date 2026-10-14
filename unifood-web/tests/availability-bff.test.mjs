import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availabilityLoader,
  availabilityFixture,
  itemId,
  businessDate,
} from "./helpers/load-availability.mjs";

const root = "/api/worker/availability/today";
const worker = {
  profile: { active: true, roles: ["WORKER"] },
  accessToken: "verified-session-token",
};
function routes(fetchMock, auth = worker, getAuth = async () => auth) {
  const load = availabilityLoader({
    fetchMock,
    mocks: { "@/features/auth/server/session": { getAuth } },
  });
  return {
    get: load("app/api/worker/availability/today/route.ts").GET,
    item: load("app/api/worker/availability/today/items/[itemId]/route.ts").PUT,
    cafeteria: load(
      "app/api/worker/availability/today/cafeteria-state/route.ts",
    ).PUT,
  };
}
function put(
  handler,
  kind,
  {
    id = itemId,
    origin = "http://localhost:3100",
    day = businessDate,
    body = kind === "item" ? { available: true } : { open: true },
    contentType = "application/json",
  } = {},
) {
  const path =
    kind === "item" ? `${root}/items/${id}` : `${root}/cafeteria-state`;
  const headers = {
    origin,
    "content-type": contentType,
    authorization: "Bearer forged-token",
    "x-cafeteria-id": "FOREIGN",
  };
  if (day !== undefined && day !== null) headers["X-Business-Date"] = day;
  return handler[kind](
    new Request(`http://localhost:3100${path}?cafeteriaId=FOREIGN`, {
      method: "PUT",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId: id }) },
  );
}

test("availability GET forwards only verified identity and returns the picked no-store DTO", async () => {
  const calls = [];
  const payload = availabilityFixture();
  payload.privateToken = "PRIVATE";
  payload.cafeteria.privateOwner = "PRIVATE";
  payload.categories[1].items[0].stock = 300;
  const result = await routes(async (url, options) => {
    calls.push([url, options]);
    return Response.json(payload, {
      headers: { "set-cookie": "PRIVATE", authorization: "PRIVATE" },
    });
  }).get(
    new Request(`http://localhost:3100${root}?cafeteriaId=FOREIGN`, {
      headers: { authorization: "Bearer forged" },
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), availabilityFixture());
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `http://backend.test:8080${root}`);
  assert.deepEqual(calls[0][1].headers, {
    authorization: "Bearer verified-session-token",
    accept: "application/json",
  });
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].redirect, "error");
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

for (const kind of ["item", "cafeteria"]) {
  test(`${kind} PUT forwards the strict absolute body and the GET day as a precondition`, async () => {
    const calls = [];
    const handler = routes(async (url, options) => {
      calls.push([url, options]);
      const body = {
        businessDate,
        ...(kind === "item" ? { itemId, available: false } : { open: false }),
        secret: "PRIVATE",
      };
      return Response.json(body);
    });
    const result = await put(handler, kind, {
      body: kind === "item" ? { available: false } : { open: false },
    });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(
      url,
      `http://backend.test:8080${root}/${kind === "item" ? `items/${itemId}` : "cafeteria-state"}`,
    );
    assert.deepEqual(options.headers, {
      authorization: "Bearer verified-session-token",
      accept: "application/json",
      "Content-Type": "application/json",
      "X-Business-Date": businessDate,
    });
    assert.deepEqual(
      JSON.parse(options.body),
      kind === "item" ? { available: false } : { open: false },
    );
    assert.equal(options.method, "PUT");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.ok(!(await result.text()).includes("PRIVATE"));
  });
  test(`${kind} PUT denies cross-origin, missing context, invalid dates and non-boolean or extra fields`, async () => {
    const handler = routes(async () => assert.fail("Must not reach Spring"));
    for (const origin of ["", "https://attacker.invalid"])
      assert.equal((await put(handler, kind, { origin })).status, 403);
    for (const day of [null, "bad-date", "2026-02-31", "2026-13-01"])
      assert.equal((await put(handler, kind, { day })).status, 400);
    const field = kind === "item" ? "available" : "open";
    for (const body of [
      {},
      null,
      [],
      { [field]: null },
      { [field]: "true" },
      { [field]: 1 },
      { [field]: true, cafeteriaId: "FOREIGN" },
      { [field]: true, other: false },
      "{",
      "x".repeat(1025),
    ])
      assert.equal((await put(handler, kind, { body })).status, 400);
    assert.equal(
      (await put(handler, kind, { contentType: "text/plain" })).status,
      400,
    );
    if (kind === "item")
      assert.equal(
        (await put(handler, kind, { id: "../outside" })).status,
        400,
      );
  });
  test(`${kind} PUT preserves 404, all 409 variants and temporary 503 with safe messages`, async () => {
    for (const [status, code] of [
      [404, "AVAILABILITY_ITEM_NOT_FOUND"],
      [409, "AVAILABILITY_DAY_EXPIRED"],
      [409, "AVAILABILITY_CAFETERIA_INACTIVE"],
      [409, "AVAILABILITY_ITEM_INACTIVE"],
      [503, "AVAILABILITY_TEMPORARILY_UNAVAILABLE"],
    ]) {
      const result = await put(
        routes(async () =>
          Response.json(
            { code, message: "PRIVATE", cafeteria: "FOREIGN" },
            {
              status,
              headers: { "Retry-After": "9", "Set-Cookie": "PRIVATE" },
            },
          ),
        ),
        kind,
      );
      assert.equal(result.status, status);
      assert.equal((await result.json()).code, code);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.headers.get("set-cookie"), null);
      if (status === 503) assert.equal(result.headers.get("retry-after"), "9");
    }
  });
}

test("GET and both PUT routes enforce active exclusive WORKER roles", async () => {
  for (const [auth, status] of [
    [null, 401],
    [{ ...worker, profile: { active: false, roles: ["WORKER"] } }, 403],
    ...[[], ["CLIENT"], ["ADMIN"], ["SUPER_ADMIN"], ["WORKER", "ADMIN"]].map(
      (roles) => [{ ...worker, profile: { active: true, roles } }, 403],
    ),
  ]) {
    const handler = routes(
      async () => assert.fail("Must not reach Spring"),
      auth,
    );
    assert.equal(
      (await handler.get(new Request(`http://localhost:3100${root}`))).status,
      status,
    );
    for (const kind of ["item", "cafeteria"])
      assert.equal((await put(handler, kind)).status, status);
  }
});

test("temporary Auth verification never clears session or reaches business endpoints", async () => {
  const handler = routes(
    async () => assert.fail("No token may be forwarded"),
    worker,
    async () => {
      throw Object.assign(new Error("PRIVATE"), {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
      });
    },
  );
  for (const result of [
    await handler.get(new Request(`http://localhost:3100${root}`)),
    await put(handler, "item"),
    await put(handler, "cafeteria"),
  ]) {
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, "AUTH_TEMPORARILY_UNAVAILABLE");
    assert.equal(result.headers.get("set-cookie"), null);
    assert.equal(result.headers.get("retry-after"), "5");
  }
});

test("GET preserves safe 401/403/503/500 contracts and discards technical upstream fields", async () => {
  for (const [status, code] of [
    [401, "AVAILABILITY_UNAUTHORIZED"],
    [403, "AVAILABILITY_FORBIDDEN"],
    [503, "AVAILABILITY_TEMPORARILY_UNAVAILABLE"],
    [500, "AVAILABILITY_CATALOG_INVALID"],
  ]) {
    const result = await routes(async () =>
      Response.json({ code, message: "PRIVATE" }, { status }),
    ).get(new Request(`http://localhost:3100${root}`));
    assert.equal(result.status, status);
    const body = await result.json();
    assert.equal(body.code, code);
    assert.ok(!body.message.includes("PRIVATE"));
  }
});

test("GET rejects invalid success DTOs, duplicate products and wrong category order", async () => {
  const badOrder = availabilityFixture();
  badOrder.categories.reverse();
  const duplicate = availabilityFixture();
  duplicate.categories[0].items.push(duplicate.categories[1].items[0]);
  const badBoolean = availabilityFixture();
  badBoolean.cafeteria.open = "true";
  for (const body of [null, [], {}, badOrder, duplicate, badBoolean])
    assert.equal(
      (
        await routes(async () => Response.json(body)).get(
          new Request(`http://localhost:3100${root}`),
        )
      ).status,
      502,
    );
});

test("transport and body timeouts return safe recoverable 503 without cookies", async () => {
  for (const fail of [
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
    const result = await routes(fail).get(
      new Request(`http://localhost:3100${root}`),
    );
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("set-cookie"), null);
    assert.ok(!(await result.text()).includes("PRIVATE"));
  }
});

test("a mismatched acknowledgement cannot change another resource, day or requested flag", async () => {
  for (const body of [
    { businessDate: "2026-10-14", itemId, available: true },
    { businessDate, itemId: "FOREIGN", available: true },
    { businessDate, itemId, available: false },
  ])
    assert.equal(
      (
        await put(
          routes(async () => Response.json(body)),
          "item",
        )
      ).status,
      502,
    );
});
