import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
const tick = () => new Promise(setImmediate);
function setup(nowValue = "2026-10-14T17:00:00Z") {
  const load = availabilityLoader();
  const { WorkerHistoryStore } = load("features/worker-history/state.ts");
  const { WorkerHistoryError } = load("features/worker-history/errors.ts");
  const requests = [],
    timers = new Map(),
    focus = new Set(),
    visibility = new Set();
  let now = Date.parse(nowValue),
    visible = true,
    seq = 0;
  const store = new WorkerHistoryStore({
    page(criteria, signal) {
      return new Promise((resolve, reject) =>
        requests.push({ criteria, signal, resolve, reject }),
      );
    },
  });
  const runtime = {
    now: () => now,
    visible: () => visible,
    later(callback, delay) {
      const id = ++seq;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
    onFocus: (fn) => {
      focus.add(fn);
      return () => focus.delete(fn);
    },
    onVisibility: (fn) => {
      visibility.add(fn);
      return () => visibility.delete(fn);
    },
  };
  return {
    store,
    requests,
    WorkerHistoryError,
    timers,
    start: () => store.start(runtime),
    async resolve(index = requests.length - 1, data = workerHistoryFixture()) {
      requests[index].resolve(data);
      await tick();
    },
    async advance(ms) {
      now += ms;
      const due = [...timers].filter(([, t]) => t.at <= now);
      for (const [id, t] of due) {
        if (timers.delete(id)) t.callback();
      }
      await tick();
    },
    async visible(value) {
      visible = value;
      visibility.forEach((fn) => fn());
      await tick();
    },
    async focus() {
      focus.forEach((fn) => fn());
      await tick();
    },
  };
}
test("entry, debounce and clearing use server queries and reset paging without stale cards", async () => {
  const a = setup();
  a.start();
  await a.resolve();
  a.store.setQuery("P");
  await a.advance(200);
  a.store.setQuery("Pérez");
  assert.equal(a.store.getSnapshot().query, "Pérez");
  assert.equal(a.store.getSnapshot().data, null);
  await a.advance(299);
  assert.equal(a.requests.length, 1);
  await a.advance(1);
  assert.equal(a.requests.length, 2);
  assert.equal(a.requests[1].criteria.q, "Pérez");
  assert.equal(a.requests[1].criteria.cursor, undefined);
  await a.resolve(1);
  a.store.setQuery("");
  assert.equal(a.requests.length, 3);
  assert.equal(a.requests[2].criteria.q, "");
  await a.resolve(2);
  a.store.dispose();
});
test("late search success and error cannot replace newer criteria", async () => {
  const a = setup();
  a.start();
  await a.resolve();
  a.store.setQuery("old");
  await a.advance(300);
  a.store.setQuery("new");
  assert.equal(a.requests[1].signal.aborted, true);
  await a.advance(300);
  await a.resolve(2, {
    ...workerHistoryFixture(),
    orders: [],
    hasHistory: true,
  });
  await a.resolve(1);
  assert.deepEqual(a.store.getSnapshot().data.orders, []);
  a.store.setQuery("failure");
  await a.advance(300);
  a.store.setRange("TODAY");
  a.requests[3].reject(new Error("late"));
  await a.resolve(4);
  assert.equal(a.store.getSnapshot().error, null);
  assert.equal(a.store.getSnapshot().range, "TODAY");
  a.store.dispose();
});
test("load more appends once, ignores duplicate IDs, and every criteria change resets cursor", async () => {
  const a = setup();
  a.start();
  const first = workerHistoryFixture();
  first.orders = first.orders.slice(0, 1);
  first.nextCursor = "page2";
  await a.resolve(0, first);
  void a.store.loadMore();
  void a.store.loadMore();
  assert.equal(a.requests.length, 2);
  assert.equal(a.requests[1].criteria.cursor, "page2");
  await a.resolve(1);
  assert.equal(a.store.getSnapshot().data.orders.length, 3);
  a.store.setRange("WEEK");
  assert.equal(a.requests[2].criteria.cursor, undefined);
  assert.equal(a.requests[2].criteria.range, "WEEK");
  await a.resolve(2, first);
  a.store.setStatus("CANCELLED");
  assert.equal(a.requests[3].criteria.cursor, undefined);
  assert.equal(a.requests[3].criteria.status, "CANCELLED");
  await a.resolve(3);
  a.store.clearFilters();
  assert.equal(a.requests[4].criteria.range, "MONTH");
  assert.equal(a.requests[4].criteria.status, undefined);
  a.store.dispose();
});
test("polling/focus group slow requests, preserve search, and 503 recovers without logout", async () => {
  const a = setup();
  a.start();
  await a.focus();
  await a.advance(30000);
  assert.equal(a.requests.length, 1);
  await a.resolve();
  a.store.setQuery("Juan");
  await a.advance(300);
  await a.resolve(1);
  await a.advance(30000);
  await a.focus();
  assert.equal(a.requests.length, 3);
  a.requests[2].reject(new a.WorkerHistoryError(503));
  await tick();
  assert.equal(a.store.getSnapshot().query, "Juan");
  assert.ok(a.store.getSnapshot().data);
  void a.store.refresh();
  await a.resolve(3);
  assert.equal(a.store.getSnapshot().error, null);
  a.store.dispose();
});
test("month deadline immediately hides previous results and rejects an old in-flight snapshot", async () => {
  const a = setup("2026-11-01T04:59:59Z");
  a.start();
  const old = {
    ...workerHistoryFixture(),
    businessDate: "2026-10-31",
    nextBusinessDateAt: "2026-11-01T05:00:00Z",
    rangeEnd: "2026-11-01",
  };
  await a.resolve(0, old);
  void a.store.refresh();
  await a.advance(1000);
  assert.equal(a.store.getSnapshot().data, null);
  assert.equal(a.requests[1].signal.aborted, true);
  assert.equal(a.requests.length, 3);
  await a.resolve(1, old);
  assert.equal(a.store.getSnapshot().data, null);
  await a.resolve(2, {
    businessDate: "2026-11-01",
    monthStart: "2026-11-01",
    rangeStart: "2026-11-01",
    rangeEnd: "2026-11-02",
    nextBusinessDateAt: "2026-11-02T05:00:00Z",
    orders: [],
    nextCursor: null,
    hasHistory: false,
  });
  assert.equal(a.store.getSnapshot().data.monthStart, "2026-11-01");
  a.store.dispose();
});
test("an already expired server snapshot never reappears and cannot cause a hot loop", async () => {
  const a = setup("2026-11-01T05:00:00Z");
  a.start();
  await a.resolve();
  assert.equal(a.store.getSnapshot().data, null);
  assert.equal(a.requests.length, 1);
  assert.equal(a.store.getSnapshot().error.status, 503);
  await a.advance(1000);
  assert.equal(a.requests.length, 1);
  a.store.dispose();
});
test("hidden tab cancels timers, focus does not query, visibility refreshes; disposal ignores late responses", async () => {
  const a = setup();
  a.start();
  await a.resolve();
  await a.visible(false);
  await a.advance(60000);
  await a.focus();
  assert.equal(a.requests.length, 1);
  await a.visible(true);
  assert.equal(a.requests.length, 2);
  a.store.dispose();
  assert.equal(a.requests[1].signal.aborted, true);
  await a.resolve(1);
  assert.equal(a.timers.size, 0);
  a.start();
  await a.resolve(2);
  assert.ok(a.store.getSnapshot().data);
  a.store.dispose();
});
for (const status of [401, 403])
  test(status + " hides private data and stops automatic retries", async () => {
    const a = setup();
    a.start();
    await a.resolve();
    void a.store.refresh();
    a.requests[1].reject(new a.WorkerHistoryError(status));
    await tick();
    assert.equal(a.store.getSnapshot().data, null);
    await a.advance(60000);
    await a.focus();
    assert.equal(a.requests.length, 2);
    a.store.dispose();
  });
test("expired cursor on load more resets and refetches first page with current filters", async () => {
  const a = setup();
  a.start();
  await a.resolve(0, { ...workerHistoryFixture(), nextCursor: "old" });
  void a.store.loadMore();
  a.requests[1].reject(new a.WorkerHistoryError(400));
  await tick();
  assert.equal(a.requests[2].criteria.cursor, undefined);
  await a.resolve(2);
  assert.equal(a.store.getSnapshot().error, null);
  a.store.dispose();
});
