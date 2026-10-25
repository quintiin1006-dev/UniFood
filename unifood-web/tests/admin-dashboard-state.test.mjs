import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";
const load = availabilityLoader();
const { AdminDashboardStore } = load("features/admin-dashboard/state.ts");
const { AdminDashboardError } = load("features/admin-dashboard/errors.ts");
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
test("initial state loads TODAY through the existing API and publishes the server cutoff", async () => {
  const store = new AdminDashboardStore({
    get: async (filters, signal) => {
      assert.deepEqual(filters, { range: "TODAY", rankingLimit: 10 });
      assert.ok(signal instanceof AbortSignal);
      return adminDashboardFixture();
    },
  });
  assert.equal(store.getSnapshot().data, null);
  assert.equal(store.getSnapshot().loading, true);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  await store.load();
  assert.equal(
    store.getSnapshot().referenceAsOf,
    adminDashboardFixture().period.asOf,
  );
  assert.equal(notifications, 2);
  unsubscribe();
});
test("changing filters clears old data immediately and cancels the older request", async () => {
  const pending = deferred();
  let captured;
  const store = new AdminDashboardStore({
    get: async (filters, signal) => {
      captured = signal;
      if (filters.range === "TODAY") return adminDashboardFixture();
      return pending.promise;
    },
  });
  await store.load();
  const reading = store.load({ range: "LAST_7_DAYS", rankingLimit: 10 });
  assert.equal(store.getSnapshot().data, null);
  assert.equal(store.getSnapshot().loading, true);
  const newer = store.load({ range: "TODAY", rankingLimit: 10 });
  assert.equal(captured.aborted, false);
  await newer;
  pending.resolve(adminDashboardFixture({ empty: true }));
  await reading;
  assert.equal(store.getSnapshot().data.summary.receivedOrders, "1");
});
test("slow responses and errors cannot overwrite the newest successful period", async () => {
  const first = deferred(),
    second = deferred();
  const signals = [];
  const requests = [first, second];
  const store = new AdminDashboardStore({
    get: (_, signal) => {
      signals.push(signal);
      return requests.shift().promise;
    },
  });
  const old = store.load(),
    current = store.load({ range: "LAST_30_DAYS", rankingLimit: 10 });
  assert.equal(signals[0].aborted, true);
  second.resolve(adminDashboardFixture({ empty: true }));
  await current;
  first.reject(new AdminDashboardError(503));
  await old;
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().filters.range, "LAST_30_DAYS");
});
for (const status of [400, 500, 502, 503])
  test(`failed period ${status} hides previous results and retry recovers`, async () => {
    let fail = false;
    const store = new AdminDashboardStore({
      get: async () => {
        if (fail) throw new AdminDashboardError(status);
        return adminDashboardFixture();
      },
    });
    await store.load();
    fail = true;
    await store.load({ range: "LAST_7_DAYS", rankingLimit: 10 });
    assert.equal(store.getSnapshot().data, null);
    assert.equal(store.getSnapshot().error.status, status);
    fail = false;
    await store.load();
    assert.equal(store.getSnapshot().error, null);
  });
for (const status of [401, 403])
  test(`definitive denial ${status} clears context and prevents background resurrection`, async () => {
    let calls = 0;
    const store = new AdminDashboardStore({
      get: async () => {
        calls++;
        throw new AdminDashboardError(status);
      },
    });
    await store.load();
    await store.load();
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().data, null);
    assert.equal(store.getSnapshot().referenceAsOf, null);
  });
test("disposed responses never publish, and a Strict Mode remount can start a fresh request", async () => {
  const first = deferred();
  let calls = 0;
  const store = new AdminDashboardStore({
    get: () =>
      calls++ === 0 ? first.promise : Promise.resolve(adminDashboardFixture()),
  });
  const old = store.load();
  store.dispose();
  first.resolve(adminDashboardFixture({ empty: true }));
  await old;
  assert.equal(store.getSnapshot().data, null);
  await store.load();
  assert.equal(store.getSnapshot().data.summary.receivedOrders, "1");
});
