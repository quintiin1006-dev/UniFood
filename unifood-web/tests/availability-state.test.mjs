import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availabilityLoader,
  availabilityFixture,
  itemId,
  secondItemId,
  businessDate,
} from "./helpers/load-availability.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise(setImmediate);
function setup() {
  const load = availabilityLoader();
  const { AvailabilityStore } = load("features/availability/state.ts");
  const { AvailabilityApiError } = load("features/availability/errors.ts");
  const reads = [],
    writes = [];
  const api = {
    today(signal) {
      const pending = deferred();
      reads.push({ ...pending, signal });
      return pending.promise;
    },
    item(id, day, available) {
      const pending = deferred();
      writes.push({ ...pending, id, day, available });
      return pending.promise;
    },
    cafeteria(day, open) {
      const pending = deferred();
      writes.push({ ...pending, day, open });
      return pending.promise;
    },
  };
  return {
    store: new AvailabilityStore(api),
    reads,
    writes,
    AvailabilityApiError,
  };
}
async function loaded(app, fixture = availabilityFixture()) {
  const request = app.store.start();
  await tick();
  app.reads[0].resolve(fixture);
  await request;
}
const available = (state, id = itemId) =>
  state.data.categories
    .flatMap((group) => group.items)
    .find((item) => item.id === id).available;

test("initial loading and failed GET never show a fabricated closed/unavailable state; retry recovers", async () => {
  const app = setup();
  assert.equal(app.store.getSnapshot().data, null);
  const first = app.store.start();
  await tick();
  app.reads[0].reject(new app.AvailabilityApiError(503));
  await first;
  assert.equal(app.store.getSnapshot().loading, false);
  assert.equal(app.store.getSnapshot().data, null);
  assert.ok(app.store.getSnapshot().error);
  const retry = app.store.refresh();
  await tick();
  app.reads[1].resolve(availabilityFixture());
  await retry;
  assert.equal(app.store.getSnapshot().error, null);
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
});

test("product changes immediately as an optimistic overlay and another product saves independently", async () => {
  const app = setup();
  await loaded(app);
  const first = app.store.setItem(itemId, true);
  assert.equal(available(app.store.getSnapshot()), true);
  assert.equal(available(app.store.getSnapshot(), secondItemId), false);
  assert.deepEqual(app.store.getSnapshot().busyItems, [itemId]);
  await app.store.setItem(itemId, true);
  assert.equal(app.writes.length, 1);
  const second = app.store.setItem(secondItemId, true);
  assert.equal(app.writes.length, 2);
  assert.equal(available(app.store.getSnapshot(), secondItemId), true);
  app.writes[1].resolve({
    businessDate,
    itemId: secondItemId,
    available: true,
  });
  await second;
  assert.equal(available(app.store.getSnapshot(), secondItemId), true);
  assert.deepEqual(app.store.getSnapshot().busyItems, [itemId]);
  app.writes[0].resolve({ businessDate, itemId, available: true });
  await first;
  assert.equal(available(app.store.getSnapshot()), true);
  assert.equal(available(app.store.getSnapshot(), secondItemId), true);
  assert.deepEqual(app.store.getSnapshot().busyItems, []);
});

test("cafeteria opens and closes optimistically without blocking a different product", async () => {
  const app = setup();
  await loaded(app);
  const opening = app.store.setCafeteria(true);
  assert.equal(app.store.getSnapshot().cafeteriaBusy, true);
  assert.equal(app.store.getSnapshot().data.cafeteria.open, true);
  const product = app.store.setItem(itemId, true);
  app.writes[1].resolve({ businessDate, itemId, available: true });
  await product;
  app.writes[0].resolve({ businessDate, open: true });
  await opening;
  assert.equal(app.store.getSnapshot().data.cafeteria.open, true);
  const closing = app.store.setCafeteria(false);
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
  assert.equal(app.store.getSnapshot().cafeteriaBusy, true);
  app.writes[2].resolve({ businessDate, open: false });
  await closing;
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
  assert.equal(app.store.getSnapshot().cafeteriaBusy, false);
});

test("inactive cafeteria blocks true while allowing close and product disable", async () => {
  const app = setup();
  await loaded(
    app,
    availabilityFixture({ active: false, open: true, available: true }),
  );
  await app.store.setCafeteria(true);
  await app.store.setItem(secondItemId, true);
  assert.equal(app.writes.length, 0);
  const closing = app.store.setCafeteria(false),
    disabling = app.store.setItem(itemId, false);
  app.writes[0].resolve({ businessDate, open: false });
  app.writes[1].resolve({ businessDate, itemId, available: false });
  await Promise.all([closing, disabling]);
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
  assert.equal(available(app.store.getSnapshot()), false);
});

test("stale 409 replaces the complete day state and never replays the PUT on tomorrow", async () => {
  const app = setup();
  await loaded(app, availabilityFixture({ open: true, available: true }));
  const changing = app.store.setItem(itemId, false);
  assert.equal(available(app.store.getSnapshot()), false);
  app.writes[0].reject(
    new app.AvailabilityApiError(409, "AVAILABILITY_DAY_EXPIRED"),
  );
  await tick();
  assert.equal(app.store.getSnapshot().refreshing, true);
  assert.equal(available(app.store.getSnapshot()), true);
  const tomorrow = availabilityFixture();
  tomorrow.businessDate = "2026-10-14";
  app.reads[1].resolve(tomorrow);
  await changing;
  assert.equal(app.store.getSnapshot().data.businessDate, "2026-10-14");
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
  assert.equal(available(app.store.getSnapshot()), false);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].day, businessDate);
  assert.match(
    app.store.getSnapshot().notice,
    /Actualizamos la disponibilidad/,
  );
  assert.deepEqual(app.store.getSnapshot().itemErrors, {});
});

test("a conflict waits for other in-flight writes before refreshing and rejects stale acknowledgements", async () => {
  const app = setup();
  await loaded(app);
  const first = app.store.setItem(itemId, true),
    second = app.store.setItem(secondItemId, true);
  app.writes[0].reject(
    new app.AvailabilityApiError(409, "AVAILABILITY_DAY_EXPIRED"),
  );
  await tick();
  assert.equal(app.reads.length, 1);
  assert.equal(available(app.store.getSnapshot()), false);
  assert.equal(available(app.store.getSnapshot(), secondItemId), true);
  await app.store.setCafeteria(true);
  assert.equal(app.writes.length, 2);
  app.writes[1].resolve({
    businessDate,
    itemId: secondItemId,
    available: true,
  });
  await tick();
  assert.equal(app.reads.length, 2);
  const fresh = availabilityFixture();
  fresh.businessDate = "2026-10-14";
  app.reads[1].resolve(fresh);
  await Promise.all([first, second]);
  assert.equal(available(app.store.getSnapshot(), secondItemId), false);
  assert.equal(app.writes.length, 2);
});

for (const [status, code] of [
  [404, "AVAILABILITY_ITEM_NOT_FOUND"],
  [409, "AVAILABILITY_ITEM_INACTIVE"],
  [409, "AVAILABILITY_CAFETERIA_INACTIVE"],
]) {
  test(`${code} synchronizes the list without retrying an enabling intent`, async () => {
    const app = setup();
    await loaded(app);
    const mutation = app.store.setItem(itemId, true);
    assert.equal(available(app.store.getSnapshot()), true);
    app.writes[0].reject(new app.AvailabilityApiError(status, code));
    await tick();
    assert.equal(available(app.store.getSnapshot()), false);
    const fresh = availabilityFixture({
      active: code !== "AVAILABILITY_CAFETERIA_INACTIVE",
    });
    if (code !== "AVAILABILITY_CAFETERIA_INACTIVE")
      fresh.categories[1].items.shift();
    app.reads[1].resolve(fresh);
    await mutation;
    assert.equal(app.writes.length, 1);
    assert.ok(app.store.getSnapshot().notice);
    assert.deepEqual(app.store.getSnapshot().data, fresh);
  });
}

test("503 with failed synchronization preserves confirmed data and requires a GET retry", async () => {
  const app = setup();
  await loaded(app, availabilityFixture({ available: true }));
  const mutation = app.store.setItem(itemId, false);
  assert.equal(available(app.store.getSnapshot()), false);
  app.writes[0].reject(new app.AvailabilityApiError(503));
  await tick();
  assert.equal(available(app.store.getSnapshot()), true);
  app.reads[1].reject(new app.AvailabilityApiError(503));
  await mutation;
  assert.equal(available(app.store.getSnapshot()), true);
  assert.ok(app.store.getSnapshot().error);
  await app.store.setItem(secondItemId, true);
  assert.equal(app.writes.length, 1);
  const retry = app.store.refresh();
  await tick();
  app.reads[2].resolve(availabilityFixture());
  await retry;
  assert.equal(app.store.getSnapshot().error, null);
  assert.equal(available(app.store.getSnapshot()), false);
  assert.equal(app.writes.length, 1);
});

test("a refresh cannot replace a confirmed write with an earlier GET snapshot", async () => {
  const app = setup();
  await loaded(app);
  const mutation = app.store.setItem(itemId, true);
  await app.store.refresh();
  assert.equal(app.reads.length, 1);
  app.writes[0].resolve({ businessDate, itemId, available: true });
  await tick();
  assert.equal(app.reads.length, 2);
  assert.equal(available(app.store.getSnapshot()), true);
  app.reads[1].resolve(availabilityFixture({ available: true }));
  await mutation;
  assert.equal(available(app.store.getSnapshot()), true);
});

test("a failed product rolls back to its latest confirmation without undoing another successful product", async () => {
  const app = setup();
  const original = availabilityFixture();
  await loaded(app, original);
  const enabling = app.store.setItem(itemId, true);
  assert.equal(available(app.store.getSnapshot()), true);
  assert.equal(original.categories[1].items[0].available, false);
  app.writes[0].resolve({ businessDate, itemId, available: true });
  await enabling;
  const disabling = app.store.setItem(itemId, false);
  const other = app.store.setItem(secondItemId, true);
  app.writes[2].resolve({
    businessDate,
    itemId: secondItemId,
    available: true,
  });
  await other;
  app.writes[1].reject(new app.AvailabilityApiError(503));
  await tick();
  assert.equal(available(app.store.getSnapshot()), true);
  assert.equal(available(app.store.getSnapshot(), secondItemId), true);
  assert.equal(app.store.getSnapshot().busyItems.length, 0);
  const fresh = availabilityFixture({ available: true });
  fresh.categories[1].items[1].available = true;
  app.reads[1].resolve(fresh);
  await disabling;
  assert.equal(app.writes.length, 3);
  assert.deepEqual(app.store.getSnapshot().data, fresh);
});

for (const cause of [
  { name: "503", failure: (app) => new app.AvailabilityApiError(503) },
  {
    name: "timeout",
    failure: () =>
      Object.assign(new Error("PRIVATE"), { name: "TimeoutError" }),
  },
  { name: "network", failure: () => new TypeError("PRIVATE_NETWORK") },
]) {
  test(`${cause.name} rolls back optimistic cafeteria and product changes before synchronization`, async () => {
    const app = setup();
    await loaded(app, availabilityFixture({ open: true, available: true }));
    const product = app.store.setItem(itemId, false);
    const cafeteria = app.store.setCafeteria(false);
    assert.equal(available(app.store.getSnapshot()), false);
    assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
    app.writes[0].reject(cause.failure(app));
    await tick();
    assert.equal(available(app.store.getSnapshot()), true);
    assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
    assert.equal(app.reads.length, 1);
    app.writes[1].reject(cause.failure(app));
    await tick();
    assert.equal(app.store.getSnapshot().data.cafeteria.open, true);
    assert.equal(app.reads.length, 2);
    assert.ok(!app.store.getSnapshot().notice.includes("PRIVATE"));
    app.reads[1].resolve(availabilityFixture({ open: true, available: true }));
    await Promise.all([product, cafeteria]);
    assert.equal(app.writes.length, 2);
    assert.equal(app.store.getSnapshot().cafeteriaBusy, false);
    assert.deepEqual(app.store.getSnapshot().busyItems, []);
  });
}

test("leaving the module removes its optimistic overlay and ignores late write acknowledgements", async () => {
  const app = setup();
  await loaded(app);
  const mutation = app.store.setItem(itemId, true);
  app.store.dispose();
  assert.equal(available(app.store.getSnapshot()), false);
  const returning = app.store.start();
  await tick();
  app.writes[0].resolve({ businessDate, itemId, available: true });
  await mutation;
  assert.equal(available(app.store.getSnapshot()), false);
  app.reads[1].resolve(availabilityFixture());
  await returning;
  assert.equal(available(app.store.getSnapshot()), false);
  assert.equal(app.writes.length, 1);
});

test("cleanup invalidates old responses and a remount can recover without stale updates", async () => {
  const app = setup();
  const first = app.store.start();
  await tick();
  app.store.dispose();
  const second = app.store.start();
  await tick();
  app.reads[0].resolve(availabilityFixture({ open: true }));
  await first;
  assert.equal(app.store.getSnapshot().data, null);
  app.reads[1].resolve(availabilityFixture());
  await second;
  assert.equal(app.store.getSnapshot().data.cafeteria.open, false);
});
