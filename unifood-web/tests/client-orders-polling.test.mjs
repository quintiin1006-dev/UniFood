import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const polling = loadTs("features/client-orders/polling.ts");

const order = (status, extra = {}) => ({
  id: "00000000-0000-0000-0000-000000000051",
  status,
  reminderCount: 0,
  ...extra,
});

/** Timers the test drives by hand: nothing waits for real time. */
function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    set: (callback, ms) => {
      pending.set(next, { callback, ms });
      return next++;
    },
    clear: (handle) => pending.delete(handle),
    delays: () => [...pending.values()].map((entry) => entry.ms),
    count: () => pending.size,
    async fire() {
      const [[id, entry]] = [...pending.entries()];
      pending.delete(id);
      entry.callback();
      await settle();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness(results, { visible = true } = {}) {
  const timers = manualTimers();
  const state = { visible, etags: [], seen: [] };
  const queue = [...results];
  const poller = polling.createPoller({
    timers,
    isVisible: () => state.visible,
    load: async (etag) => {
      state.etags.push(etag);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    onResult: (result, failures) => state.seen.push({ result, failures }),
  });
  return { poller, timers, state };
}

test("polls every 5 s and sends the last ETag back", async () => {
  const { poller, timers, state } = harness([
    { kind: "order", order: order("PENDING"), etag: '"a"' },
    { kind: "unchanged" },
  ]);
  poller.start();
  await settle();
  assert.deepEqual(state.etags, [null]);
  assert.deepEqual(timers.delays(), [5000]);
  await timers.fire();
  assert.deepEqual(state.etags, [null, '"a"']);
  assert.deepEqual(timers.delays(), [5000]);
  poller.stop();
  assert.equal(timers.count(), 0);
});

test("a hidden tab pauses the polling and returning reads at once", async () => {
  const { poller, timers, state } = harness([
    { kind: "order", order: order("PENDING"), etag: '"a"' },
  ]);
  poller.start();
  await settle();
  assert.equal(timers.count(), 1);
  state.visible = false;
  poller.visibilityChanged();
  assert.equal(timers.count(), 0, "no request is scheduled while hidden");
  assert.equal(state.etags.length, 1);
  state.visible = true;
  poller.visibilityChanged();
  await settle();
  assert.equal(state.etags.length, 2, "reads immediately on return");
  assert.equal(timers.count(), 1, "and keeps polling");
  poller.stop();
});

test("starting while hidden waits for the tab to come back", async () => {
  const { poller, timers, state } = harness([{ kind: "none", etag: '"n"' }], {
    visible: false,
  });
  poller.start();
  await settle();
  assert.equal(state.etags.length, 0);
  assert.equal(timers.count(), 0);
  state.visible = true;
  poller.visibilityChanged();
  await settle();
  assert.equal(state.etags.length, 1);
  poller.stop();
});

test("failures back off 10, 20, 40 s up to a minute and a success resets", async () => {
  const { poller, timers, state } = harness([
    { kind: "error" },
    new Error("network"),
    { kind: "error" },
    { kind: "error" },
    { kind: "error" },
    { kind: "none", etag: null },
  ]);
  poller.start();
  await settle();
  const delays = [timers.delays()[0]];
  for (let n = 0; n < 4; n++) {
    await timers.fire();
    delays.push(timers.delays()[0]);
  }
  assert.deepEqual(delays, [10_000, 20_000, 40_000, 60_000, 60_000]);
  assert.deepEqual(
    state.seen.map((entry) => entry.failures),
    [1, 2, 3, 4, 5],
  );
  await timers.fire();
  assert.deepEqual(timers.delays(), [5000]);
  assert.equal(state.seen.at(-1).failures, 0);
  poller.stop();
});

test("a fatal error (session over) stops the polling", async () => {
  const { poller, timers } = harness([{ kind: "error", fatal: true }]);
  poller.start();
  await settle();
  assert.equal(timers.count(), 0);
});

test("refresh reads now and never overlaps a request in flight", async () => {
  const timers = manualTimers();
  let release;
  let calls = 0;
  const poller = polling.createPoller({
    timers,
    isVisible: () => true,
    load: () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve({ kind: "unchanged" });
      });
    },
    onResult: () => {},
  });
  poller.start();
  await settle();
  poller.refresh();
  await settle();
  assert.equal(calls, 1, "the second read waits for the first");
  release();
  await settle();
  assert.equal(calls, 2, "and runs right after it");
  release();
  await settle();
  poller.stop();
});

test("a stopped poller ignores a late answer", async () => {
  const timers = manualTimers();
  let release;
  const seen = [];
  const poller = polling.createPoller({
    timers,
    isVisible: () => true,
    load: () =>
      new Promise((resolve) => {
        release = () => resolve({ kind: "none", etag: null });
      }),
    onResult: (result) => seen.push(result),
  });
  poller.start();
  await settle();
  poller.stop();
  release();
  await settle();
  assert.deepEqual(seen, []);
  assert.equal(timers.count(), 0);
});

test("nextDelay caps at one minute", () => {
  assert.equal(polling.nextDelay(0), 5000);
  assert.equal(polling.nextDelay(1), 10_000);
  assert.equal(polling.nextDelay(9), 60_000);
});

test("alerts: preparing, ready (READY or CALLED), reminders; never the first reading", () => {
  const { alertFor } = polling;
  assert.equal(alertFor(null, order("PREPARING")), null);
  assert.equal(alertFor(order("PENDING"), order("PENDING")), null);
  assert.equal(alertFor(order("PENDING"), order("PREPARING")), "preparing");
  assert.equal(alertFor(order("PREPARING"), order("READY")), "ready");
  assert.equal(alertFor(order("PREPARING"), order("CALLED")), "ready");
  assert.equal(alertFor(order("READY"), order("CALLED")), null);
  assert.equal(
    alertFor(
      order("CALLED", { reminderCount: 1 }),
      order("CALLED", { reminderCount: 2 }),
    ),
    "reminder",
  );
  assert.equal(
    alertFor(
      order("CALLED", { reminderCount: 2 }),
      order("CALLED", { reminderCount: 2 }),
    ),
    null,
  );
  assert.equal(
    alertFor(order("PENDING"), order("PREPARING", { id: "other" })),
    null,
    "a different order is a new reading",
  );
  assert.equal(alertFor(order("READY"), null), null);
});

test("the tab title announces a ready order and nothing else restores wrongly", () => {
  assert.equal(polling.tabTitle("READY"), "Tu pedido está listo | UniFood");
  assert.equal(polling.tabTitle("CALLED"), "Tu pedido está listo | UniFood");
  assert.equal(polling.tabTitle("PREPARING"), "Preparando tu pedido | UniFood");
  assert.equal(polling.tabTitle("PENDING"), null);
  assert.equal(polling.tabTitle(null), null);
});
