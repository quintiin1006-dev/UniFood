import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
for (const q of [
  "a91c",
  "Juan Pérez",
  "  PEREZ  ",
  "DELIVERED",
  "No recogido",
  "hamburguesa",
]) {
  test(
    "search criteria reach the server without local filtering: " + q,
    async () => {
      let call;
      const api = availabilityLoader({
        fetchMock: async (url, options) => {
          call = { url, options };
          return Response.json(workerHistoryFixture());
        },
      })("features/worker-history/api.ts").workerHistoryApi;
      const result = await api.page({
        q,
        range: "WEEK",
        status: "DELIVERED",
        cursor: "opaque",
        limit: 50,
      });
      const params = new URL(call.url, "http://localhost").searchParams;
      assert.equal(params.get("q"), q);
      assert.equal(params.get("range"), "WEEK");
      assert.equal(params.get("cursor"), "opaque");
      assert.equal(params.get("limit"), "50");
      assert.equal(
        result.orders.length,
        3,
        "Browser preserves the server result rather than running a second search engine",
      );
      assert.equal(call.options.cache, "no-store");
      assert.equal(call.options.redirect, "error");
    },
  );
}
