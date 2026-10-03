import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Load application TypeScript without adding a second test toolchain.
const cache = new Map();
let authSession = { profile: { active: true, roles: ["WORKER"] }, accessToken: "verified-token" };
function load(file) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const loaded = { exports: {} };
  cache.set(resolved, loaded);
  const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => name === "@/features/auth/server/session" ? { getAuth: async () => authSession }
      : name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : (() => { throw new Error(`Unexpected import: ${name}`); })(),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

const api = load("features/orders/api/orderApi.ts");
const route = load("app/api/orders/[[...path]]/route.ts");
const mapper = load("features/orders/utils/orderMapper.ts");
const id = "00000000-0000-0000-0000-000000000001";
const fixture = { id, status: "PENDING", clientName: "Prueba", createdAt: "2026-09-27T10:00:00Z", updatedAt: "2026-09-27T10:00:00Z", items: [] };

test("complete API flow, backend priority rejection, cancellation and terminal states", async () => {
  const original = global.fetch;
  const requests = [];
  let rejectPriority = true;
  global.fetch = async (url, options) => {
    requests.push([url, options.method]);
    if (options.method === "GET") return Response.json([fixture]);
    if (url.endsWith("/prepare") && rejectPriority) {
      return new Response("El pedido anterior debe ser procesado primero.", { status: 409 });
    }
    const statuses = { prepare: "PREPARING", ready: "READY", call: "CALLED", deliver: "DELIVERED", cancel: "CANCELLED" };
    return Response.json({ ...fixture, status: statuses[url.split("/").at(-1)] });
  };
  try {
    let [order] = await api.getOrders();
    await assert.rejects(api.advanceOrder(order), (error) => error.status === 409 && /pedido anterior/.test(error.message));
    assert.equal(order.status, "pending");
    rejectPriority = false;
    for (const status of ["preparing", "ready", "called", "delivered"]) {
      order = await api.advanceOrder(order);
      assert.equal(order.status, status);
    }
    const count = requests.length;
    await api.advanceOrder(order);
    assert.equal(requests.length, count);
    assert.equal((await api.cancelOrder(mapper.mapBackendOrder(fixture))).status, "cancelled");
    await assert.rejects(api.cancelOrder(order), /pendiente/);
    assert.ok(requests.every(([url]) => url.startsWith("/api/orders")));
    assert.equal(mapper.mapOrderStatus("NOT_COLLECTED"), "not_collected");
    assert.throws(() => mapper.mapOrderStatus("UNKNOWN"), /desconocido/);
    global.fetch = async () => Response.json({ message: "Backend no disponible" }, { status: 502 });
    await assert.rejects(api.getOrders(), /Backend no disponible/);
  } finally { global.fetch = original; }
});

test("Next proxy preserves GET query, PATCH, authorization and backend conflict", async () => {
  const original = global.fetch;
  const received = [];
  global.fetch = async (url, options) => {
    received.push([String(url), options]);
    return new Response("El pedido anterior debe ser procesado primero.", { status: 409 });
  };
  try {
    const request = new Request(`http://localhost:3001/api/orders/${id}/prepare`, {
      method: "PATCH", headers: { authorization: "Bearer test", origin: "http://localhost:3001" },
    });
    const response = await route.PATCH(request, { params: Promise.resolve({ path: [id, "prepare"] }) });
    assert.equal(response.status, 409);
    assert.match(await response.text(), /pedido anterior/);
    assert.equal(received[0][1].method, "PATCH");
    assert.equal(received[0][1].headers.get("authorization"), "Bearer verified-token");
    assert.equal(received[0][1].headers.get("origin"), null);
    await route.GET(new Request("http://localhost:3001/api/orders?cafeteriaId=test"), { params: Promise.resolve({}) });
    assert.match(received[1][0], /cafeteriaId=test/);
    const invalid = await route.PATCH(request, { params: Promise.resolve({ path: [id, "unknown"] }) });
    assert.equal(invalid.status, 404);
    assert.equal(received.length, 2);
    global.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const unavailable = await route.GET(new Request("http://localhost:3001/api/orders"), { params: Promise.resolve({}) });
    assert.equal(unavailable.status, 502);
    assert.match((await unavailable.json()).message, /backend/);
  } finally { global.fetch = original; }
});

