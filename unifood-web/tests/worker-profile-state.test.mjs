import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import {
  workerProfileFixture,
  workerProfileBusinessFixture,
} from "./helpers/worker-profile-fixture.mjs";
const load = availabilityLoader();
const { WorkerProfileStore } = load("features/worker-profile/state.ts");
const { WorkerProfileError } = load("features/worker-profile/errors.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("profile store loads, prevents duplicate reads and retries temporary errors", async () => {
  let fail = true,
    calls = 0;
  const store = new WorkerProfileStore({
    async get() {
      calls++;
      if (fail) throw new WorkerProfileError(503);
      return workerProfileFixture();
    },
  });
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  assert.equal(store.getSnapshot().loading, true);
  store.start();
  await tick();
  assert.equal(store.getSnapshot().error.status, 503);
  assert.equal(store.getSnapshot().data, null);
  fail = false;
  await store.refresh();
  assert.deepEqual(store.getSnapshot().data, workerProfileFixture());
  assert.equal(store.getSnapshot().error, null);
  assert.equal(calls, 2);
  assert.ok(changes >= 4);
  unsubscribe();
  store.dispose();
});
test("unmount aborts reads and a late response cannot replace a remounted profile", async () => {
  const pending = [],
    signals = [];
  const store = new WorkerProfileStore({
    get(signal) {
      signals.push(signal);
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  store.start();
  void store.refresh();
  assert.equal(pending.length, 1);
  store.dispose();
  assert.equal(signals[0].aborted, true);
  store.start();
  assert.equal(pending.length, 2);
  pending[0]({ ...workerProfileFixture(), email: "old@example.invalid" });
  await tick();
  assert.equal(store.getSnapshot().data, null);
  pending[1](workerProfileFixture());
  await tick();
  assert.equal(store.getSnapshot().data.email, "worker@example.invalid");
  store.dispose();
});
test("denials discard earlier identity data and unexpected failures are sanitized", async () => {
  for (const status of [401, 403, 500, 502]) {
    let error = null;
    const store = new WorkerProfileStore({
      async get() {
        if (error) throw error;
        return workerProfileFixture();
      },
    });
    store.start();
    await tick();
    error = new WorkerProfileError(status);
    await store.refresh();
    assert.equal(store.getSnapshot().data, null);
    assert.equal(store.getSnapshot().error.status, status);
    error = new Error("PRIVATE");
    await store.refresh();
    assert.equal(store.getSnapshot().error.status, 503);
    assert.ok(!store.getSnapshot().error.message.includes("PRIVATE"));
    store.dispose();
  }
});
test("contracts reject partial or malformed snapshots and strip all private extra fields", () => {
  const { parseWorkerProfile, parseWorkerBusinessProfile } = load(
    "features/worker-profile/contracts.ts",
  );
  const value = workerProfileFixture();
  value.id = "PRIVATE";
  value.metadata = "PRIVATE";
  value.cafeteria.id = "PRIVATE";
  assert.deepEqual(parseWorkerProfile(value), workerProfileFixture());
  for (const invalid of [
    null,
    [],
    {},
    { ...value, email: "" },
    { ...value, email: "bad" },
    { ...value, role: "ADMIN" },
    { ...value, cafeteria: { name: "Cafe", active: 0 } },
    { ...value, site: null },
    { ...value, institution: { name: " " } },
  ])
    assert.equal(parseWorkerProfile(invalid), null);
  assert.deepEqual(
    parseWorkerBusinessProfile(workerProfileBusinessFixture()),
    workerProfileBusinessFixture(),
  );
});
test("browser API validates snapshots, blocks redirects, applies timeout and trusts only fixed BFF route", async () => {
  const { workerProfileApi } = availabilityLoader({
    fetchMock: async (url, options) => {
      assert.equal(url, "/api/worker/profile");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "same-origin");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(workerProfileFixture());
    },
  })("features/worker-profile/api.ts");
  assert.deepEqual(await workerProfileApi.get(), workerProfileFixture());
  for (const response of [
    () => Response.json({}),
    () => new Response("PRIVATE"),
    () => Response.json({ message: "PRIVATE" }, { status: 503 }),
  ]) {
    const api = availabilityLoader({ fetchMock: async () => response() })(
      "features/worker-profile/api.ts",
    ).workerProfileApi;
    await assert.rejects(
      api.get(),
      (error) =>
        !error.message.includes("PRIVATE") && [502, 503].includes(error.status),
    );
  }
});
