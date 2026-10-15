import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
const tick = () => new Promise(setImmediate);

function setup() {
  const load = availabilityLoader();
  const { WorkerHistoryStore } = load("features/worker-history/state.ts");
  const { WorkerHistoryError } = load("features/worker-history/errors.ts");
  const requests = [],
    timers = new Map(),
    focus = new Set(),
    visibility = new Set();
  let now = Date.parse("2026-10-14T17:00:00Z"),
    visible = true,
    sequence = 0;
  const store = new WorkerHistoryStore({
    today(signal) {
      return new Promise((resolve, reject) =>
        requests.push({ resolve, reject, signal }),
      );
    },
  });
  const runtime = {
    now: () => now,
    visible: () => visible,
    later(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    onFocus(callback) {
      focus.add(callback);
      return () => focus.delete(callback);
    },
    onVisibility(callback) {
      visibility.add(callback);
      return () => visibility.delete(callback);
    },
  };
  return {
    store,
    runtime,
    requests,
    timers,
    focus,
    visibility,
    WorkerHistoryError,
    start() {
      store.start(runtime);
    },
    setVisible(next) {
      visible = next;
      visibility.forEach((callback) => callback());
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = end;
    },
    async resolve(index = requests.length - 1, data = workerHistoryFixture()) {
      requests[index].resolve(data);
      await tick();
    },
  };
}

test("history loads on entry, exposes a snapshot and replaces it on manual refresh", async () => {
  const app = setup();
  app.start();
  assert.equal(app.store.getSnapshot().loading, true);
  assert.equal(app.requests.length, 1);
  await app.resolve();
  assert.equal(app.store.getSnapshot().loading, false);
  assert.equal(app.store.getSnapshot().data.orders.length, 3);
  const request = app.store.refresh();
  assert.equal(app.store.getSnapshot().refreshing, true);
  await app.resolve(1, { ...workerHistoryFixture(), orders: [] });
  await request;
  assert.deepEqual(app.store.getSnapshot().data.orders, []);
});
test("30-second polling and focus never overlap one slow request", async () => {
  const app = setup();
  app.start();
  app.advance(90000);
  app.focus.forEach((f) => f());
  assert.equal(app.requests.length, 1);
  await app.resolve();
  app.advance(29999);
  assert.equal(app.requests.length, 1);
  app.advance(1);
  assert.equal(app.requests.length, 2);
  await app.resolve();
  app.focus.forEach((f) => f());
  assert.equal(app.requests.length, 3);
});
test("hidden history stops timers, focus cannot poll it, visibility refreshes on return", async () => {
  const app = setup();
  app.start();
  await app.resolve();
  app.setVisible(false);
  assert.equal(app.timers.size, 0);
  app.advance(90000);
  app.focus.forEach((f) => f());
  assert.equal(app.requests.length, 1);
  app.setVisible(true);
  assert.equal(app.requests.length, 2);
  await app.resolve();
  app.advance(30000);
  assert.equal(app.requests.length, 3);
});
test("nextBusinessDateAt triggers a GET and the new backend date replaces every old order", async () => {
  const app = setup();
  app.start();
  await app.resolve(0, {
    ...workerHistoryFixture(),
    nextBusinessDateAt: "2026-10-14T17:00:05Z",
  });
  app.advance(4999);
  assert.equal(app.requests.length, 1);
  app.advance(1);
  assert.equal(app.requests.length, 2);
  await app.resolve(1, {
    businessDate: "2026-10-15",
    nextBusinessDateAt: "2026-10-16T05:00:00Z",
    orders: [],
  });
  assert.equal(app.store.getSnapshot().data.businessDate, "2026-10-15");
  assert.deepEqual(app.store.getSnapshot().data.orders, []);
});
test("unmount cancels requests, timers and listeners; late responses cannot change a remount", async () => {
  const app = setup();
  app.start();
  const first = app.requests[0];
  app.store.dispose();
  assert.equal(first.signal.aborted, true);
  assert.equal(app.timers.size, 0);
  assert.equal(app.focus.size, 0);
  assert.equal(app.visibility.size, 0);
  app.advance(90000);
  assert.equal(app.requests.length, 1);
  app.start();
  await app.resolve(1, { ...workerHistoryFixture(), orders: [] });
  await app.resolve(0);
  assert.deepEqual(app.store.getSnapshot().data.orders, []);
  app.store.dispose();
});
test("late errors from a disposed request cannot replace a new successful snapshot", async () => {
  const app = setup();
  app.start();
  app.store.dispose();
  app.start();
  await app.resolve(1);
  app.requests[0].reject(new app.WorkerHistoryError(401));
  await tick();
  assert.equal(app.store.getSnapshot().error, null);
  assert.equal(app.store.getSnapshot().data.orders.length, 3);
});
test("503 retains the last snapshot and manual retry recovers without fabricated data", async () => {
  const app = setup();
  app.start();
  app.requests[0].reject(new app.WorkerHistoryError(503));
  await tick();
  assert.equal(app.store.getSnapshot().data, null);
  assert.equal(app.store.getSnapshot().loading, false);
  void app.store.refresh();
  await app.resolve(1);
  void app.store.refresh();
  app.requests[2].reject(new Error("PRIVATE"));
  await tick();
  assert.equal(app.store.getSnapshot().data.orders.length, 3);
  assert.equal(
    app.store.getSnapshot().error.message,
    "No pudimos cargar el historial en este momento.",
  );
  app.advance(30000);
  await app.resolve(3);
  assert.equal(app.store.getSnapshot().error, null);
});
test("401/403 hide previous data and stop automatic retries without a login loop", async () => {
  for (const status of [401, 403]) {
    const app = setup();
    app.start();
    await app.resolve();
    void app.store.refresh();
    app.requests[1].reject(new app.WorkerHistoryError(status));
    await tick();
    assert.equal(app.store.getSnapshot().data, null);
    assert.equal(app.timers.size, 0);
    app.advance(90000);
    app.focus.forEach((f) => f());
    app.setVisible(true);
    assert.equal(app.requests.length, 2);
  }
});
test("a past server deadline or clock skew cannot create a tight refresh loop", async () => {
  const app = setup();
  app.start();
  await app.resolve(0, {
    ...workerHistoryFixture(),
    nextBusinessDateAt: "2026-10-14T16:00:00Z",
  });
  app.advance(29999);
  assert.equal(app.requests.length, 1);
  app.advance(1);
  assert.equal(app.requests.length, 2);
});
