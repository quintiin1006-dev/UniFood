import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
const { filterHistoryOrders, normalizeHistoryQuery } = availabilityLoader()(
  "features/worker-history/search.ts",
);
const orders = workerHistoryFixture().orders;

for (const [query, indices] of [
  ["", [0, 1, 2]],
  ["   ", [0, 1, 2]],
  ["Pedido · A91C6F2D", [0]],
  ["a91c", [0]],
  ["  A91C6f2D  ", [0]],
  ["Juan Pérez", [0]],
  ["Juan", [0, 2]],
  ["pErEz", [0]],
  ["  juan   perez  ", [0]],
  ["GOMEZ", [1]],
  ["Entregado", [0]],
  ["DELIVERED", [0]],
  ["No recogido", [1]],
  ["NOT_COLLECTED", [1]],
  ["Cancelado", [2]],
  ["CANCELLED", [2]],
  ["cancel", [2]],
  ["sin coincidencias", []],
])
  test(`local history search: ${JSON.stringify(query)}`, () => {
    assert.deepEqual(
      filterHistoryOrders(orders, query).map((order) => order.id),
      indices.map((index) => orders[index].id),
    );
  });
test("search preserves snapshots and their ordering, and never fabricates an unknown customer", () => {
  const before = structuredClone(orders);
  assert.equal(filterHistoryOrders(orders, " "), orders);
  const missingName = [{ ...orders[0], clientName: null }];
  assert.equal(filterHistoryOrders(missingName, "Juan").length, 0);
  assert.equal(filterHistoryOrders(missingName, "Entregado").length, 1);
  assert.deepEqual(orders, before);
  assert.equal(normalizeHistoryQuery("  PÉREZ   GÓMEZ "), "perez gomez");
});
