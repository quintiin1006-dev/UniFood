import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
const load = availabilityLoader();
const { parseWorkerHistory } = load("features/worker-history/contracts.ts");

test("history contract preserves backend order, exact amounts, empty orders and snapshots", () => {
  const data = workerHistoryFixture();
  data.orders.reverse();
  data.orders[0].items = [];
  assert.deepEqual(parseWorkerHistory(data), data);
  assert.deepEqual(parseWorkerHistory({ ...data, orders: [] }).orders, []);
});
test("history contract rejects an entire snapshot on any malformed field or active status", () => {
  const changes = [
    (x) => (x.orders[0].clientName = 42),
    (x) => (x.orders[0].clientName = " "),
    (x) => (x.orders[0].clientName = {}),
    (x) => (x.businessDate = "2026-02-30"),
    (x) => (x.businessDate = "2026-13-14"),
    (x) => (x.nextBusinessDateAt = "tomorrow"),
    (x) => (x.nextBusinessDateAt = "2026-10-15T25:00:00Z"),
    (x) => (x.orders = null),
    (x) => x.orders.push(x.orders[0]),
    (x) => (x.orders[0].id = "wrong"),
    (x) => (x.orders[0].reference = "private"),
    ...[
      "PENDING",
      "PREPARING",
      "READY",
      "CALLED",
      null,
      {},
      { toString: "DELIVERED" },
    ].map((status) => (x) => (x.orders[0].status = status)),
    (x) => (x.orders[0].completedAt = "2026-02-30T00:00:00Z"),
    (x) => (x.orders[0].completedAt = "2026-10-14 12:43"),
    (x) => (x.orders[0].total = "19000"),
    (x) => (x.orders[0].total = -1),
    (x) => (x.orders[0].total = Infinity),
    (x) => (x.orders[0].items = null),
    (x) => (x.orders[0].items[0].quantity = 0),
    (x) => (x.orders[0].items[0].quantity = 1.5),
    (x) => (x.orders[0].items[0].name = " "),
    (x) => (x.orders[0].items[0].unitPrice = -1),
    (x) => (x.orders[0].items[0].subtotal = NaN),
  ];
  for (const change of changes) {
    const data = workerHistoryFixture();
    change(data);
    assert.equal(parseWorkerHistory(data), null);
  }
});

test("customer display names are additive, nullable and never broaden the business DTO", () => {
  const legacy = workerHistoryFixture();
  delete legacy.orders[0].clientName;
  assert.equal(parseWorkerHistory(legacy).orders[0].clientName, null);
  legacy.orders[0].clientName = null;
  assert.equal(parseWorkerHistory(legacy).orders[0].clientName, null);
  const data = workerHistoryFixture();
  Object.assign(data.orders[0], {
    email: "PRIVATE",
    phone: "PRIVATE",
    clientId: "PRIVATE",
    clientDocument: "PRIVATE",
    authMetadata: "PRIVATE",
  });
  assert.deepEqual(parseWorkerHistory(data), workerHistoryFixture());
});
test("browser history API validates again and uses only its fixed no-store BFF path", async () => {
  let call;
  const browser = availabilityLoader({
    fetchMock: async (url, options) => {
      call = { url, options };
      return Response.json(workerHistoryFixture());
    },
  })("features/worker-history/api.ts");
  assert.deepEqual(
    await browser.workerHistoryApi.today(),
    workerHistoryFixture(),
  );
  assert.equal(call.url, "/api/worker/orders/history/today");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.credentials, "same-origin");
  const bad = availabilityLoader({
    fetchMock: async () => Response.json({ orders: [] }),
  })("features/worker-history/api.ts");
  await assert.rejects(bad.workerHistoryApi.today(), { status: 502 });
});
test("browser API sanitizes failures and keeps recoverable timeouts distinct from login", async () => {
  for (const status of [401, 403, 503]) {
    const api = availabilityLoader({
      fetchMock: async () => Response.json({ message: "PRIVATE" }, { status }),
    })("features/worker-history/api.ts").workerHistoryApi;
    await assert.rejects(
      api.today(),
      (error) => error.status === status && !error.message.includes("PRIVATE"),
    );
  }
  const api = availabilityLoader({
    fetchMock: async () => {
      throw new DOMException("PRIVATE", "TimeoutError");
    },
  })("features/worker-history/api.ts").workerHistoryApi;
  await assert.rejects(api.today(), {
    status: 503,
    message: "No pudimos cargar el historial en este momento.",
  });
});
