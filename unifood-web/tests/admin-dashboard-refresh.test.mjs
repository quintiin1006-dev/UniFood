import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";

const load = availabilityLoader();
const { AdminDashboardStore, DASHBOARD_REFRESH_FAILED } = load(
  "features/admin-dashboard/state.ts",
);
const { DashboardCache } = load("features/admin-dashboard/cache.ts");
const { AdminDashboardError } = load("features/admin-dashboard/errors.ts");
const { updatedAtLabel } = load("features/admin-dashboard/presentation.ts");

// 12:00 in Bogotá on 2026-10-24.
const NOW = new Date("2026-10-24T17:00:00Z");
const TODAY = "2026-10-24";
const past = (from = "2026-10-01", to = "2026-10-07") => ({
  range: "CUSTOM",
  from,
  to,
  rankingLimit: 10,
});

function api(respond = (filters) => fixtureFor(filters)) {
  const calls = [];
  return {
    calls,
    get: async (filters) => {
      calls.push(filters);
      return respond(filters);
    },
  };
}
const fixtureFor = (filters, asOf = NOW.toISOString()) =>
  filters.range === "CUSTOM"
    ? adminDashboardFixture({ from: filters.from, to: filters.to, asOf })
    : adminDashboardFixture({ range: filters.range, from: TODAY, asOf });

function store(backend, cache = new DashboardCache(), scope = "admin-a") {
  cache.use(scope);
  return {
    cache,
    store: new AdminDashboardStore(backend, cache, () => NOW),
  };
}

// ---------------------------------------------------------------- no polling

test("the dashboard installs no polling, focus or visibility reload", () => {
  const hook = fs.readFileSync(
    "features/admin-dashboard/useAdminDashboard.ts",
    "utf8",
  );
  const state = fs.readFileSync("features/admin-dashboard/state.ts", "utf8");
  for (const source of [hook, state]) {
    assert.doesNotMatch(source, /setInterval|setTimeout/);
    assert.doesNotMatch(source, /"focus"|visibilitychange|visibilityState/);
  }
  // It still clears the cache on the logout event that LogoutButton dispatches.
  assert.match(hook, /"unifood:logout"/);
});

test("opening loads once and nothing else queries until the period changes or «Actualizar»", async () => {
  const backend = api();
  const { store: dashboard } = store(backend);
  await dashboard.load();
  assert.equal(backend.calls.length, 1);
  assert.deepEqual(backend.calls[0], { range: "TODAY", rankingLimit: 10 });
  await dashboard.load({ range: "LAST_7_DAYS", rankingLimit: 10 });
  assert.equal(backend.calls.length, 2);
  await dashboard.refresh();
  assert.equal(backend.calls.length, 3);
  assert.equal(backend.calls[2].range, "LAST_7_DAYS");
});

// ---------------------------------------------------------------- button and time

test("«Actualizar» always queries again, even a cached past period, and keeps data while loading", async () => {
  let release;
  const backend = api((filters) =>
    backend.calls.length === 2
      ? new Promise((resolve) => {
          release = () => resolve(fixtureFor(filters));
        })
      : fixtureFor(filters),
  );
  const { store: dashboard } = store(backend);
  await dashboard.load(past());
  await dashboard.load(past());
  assert.equal(backend.calls.length, 1, "the second open came from the cache");
  const refreshing = dashboard.refresh();
  assert.equal(backend.calls.length, 2);
  assert.equal(dashboard.getSnapshot().loading, true);
  assert.notEqual(dashboard.getSnapshot().data, null, "data stays visible");
  // While it loads, another click sends nothing (the button is also disabled).
  await dashboard.refresh();
  assert.equal(backend.calls.length, 2);
  release();
  await refreshing;
  assert.equal(dashboard.getSnapshot().loading, false);
});

test("the time shown is the server's computation time in Bogotá, as HH:mm", async () => {
  assert.equal(
    updatedAtLabel("2026-10-24T17:05:00Z"),
    "Actualizado a las 12:05",
  );
  assert.equal(
    updatedAtLabel("2026-10-25T04:40:00Z"),
    "Actualizado a las 23:40",
  );
  for (const value of [null, undefined, "", "ayer"])
    assert.equal(updatedAtLabel(value), null);
  const backend = api((filters) => fixtureFor(filters, "2026-10-24T16:30:00Z"));
  const { store: dashboard } = store(backend);
  await dashboard.load();
  assert.equal(dashboard.getSnapshot().updatedAt, "2026-10-24T16:30:00Z");
});

test("the button, the time and the refresh warning render with fixed Spanish texts", () => {
  const source = fs.readFileSync(
    "features/admin-dashboard/components/AdminDashboard.tsx",
    "utf8",
  );
  assert.match(source, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(source, /disabled=\{loading \|\| denied\}/);
  assert.match(source, /updatedAtLabel\(updatedAt\)/);
  assert.match(source, /\{refreshError\}/);
  assert.equal(
    DASHBOARD_REFRESH_FAILED,
    "No pudimos actualizar el dashboard. Se muestran los datos anteriores.",
  );
  const html = renderToStaticMarkup(
    React.createElement("span", null, updatedAtLabel("2026-10-24T17:05:00Z")),
  );
  assert.match(html, /Actualizado a las 12:05/);
});

// ---------------------------------------------------------------- cache

test("a closed past period is cached: reopening it sends no query", async () => {
  const backend = api();
  const { store: dashboard, cache } = store(backend);
  await dashboard.load(past());
  await dashboard.load({ range: "TODAY", rankingLimit: 10 });
  await dashboard.load(past());
  assert.equal(backend.calls.length, 2);
  assert.equal(cache.size, 1);
  assert.equal(dashboard.getSnapshot().data.period.to, "2026-10-07");
  // A different past period is its own entry.
  await dashboard.load(past("2026-09-01", "2026-09-30"));
  assert.equal(backend.calls.length, 3);
});

test("today, or any range that includes it, is always fresh", async () => {
  const backend = api();
  const { store: dashboard, cache } = store(backend);
  for (const filters of [
    { range: "TODAY", rankingLimit: 10 },
    { range: "LAST_7_DAYS", rankingLimit: 10 },
    { range: "LAST_30_DAYS", rankingLimit: 10 },
    past("2026-10-20", TODAY),
    past(TODAY, TODAY),
  ]) {
    await dashboard.load(filters);
    await dashboard.load(filters);
  }
  assert.equal(backend.calls.length, 10);
  assert.equal(cache.size, 0);
});

test("a period the server still reports as partial is not cached", async () => {
  // asOf before the end of the requested day: the server says the data is partial.
  const backend = api((filters) =>
    adminDashboardFixture({
      from: filters.from,
      to: filters.to,
      asOf: "2026-10-07T20:00:00Z",
    }),
  );
  const { store: dashboard, cache } = store(backend);
  await dashboard.load(past());
  await dashboard.load(past());
  assert.equal(backend.calls.length, 2);
  assert.equal(cache.size, 0);
});

test("the cache never mixes cafeterias or admins: another scope empties it", async () => {
  const backend = api();
  const shared = new DashboardCache();
  const { store: first } = store(backend, shared, "admin-a|cafeteria-1");
  await first.load(past());
  assert.equal(shared.size, 1);
  // The same admin moved to another cafeteria, or another admin in the same tab.
  shared.use("admin-a|cafeteria-2");
  assert.equal(shared.size, 0);
  await first.load(past());
  assert.equal(backend.calls.length, 2);
  // Going back does not resurrect the other scope's numbers.
  shared.use("admin-a|cafeteria-1");
  await first.load(past());
  assert.equal(backend.calls.length, 3);
});

test("without a known admin and cafeteria nothing is cached", async () => {
  const backend = api();
  const { store: dashboard, cache } = store(
    backend,
    new DashboardCache(),
    null,
  );
  await dashboard.load(past());
  await dashboard.load(past());
  assert.equal(backend.calls.length, 2);
  assert.equal(cache.size, 0);
});

test("logging out empties the cache", async () => {
  const backend = api();
  const { store: dashboard, cache } = store(backend);
  await dashboard.load(past());
  cache.clear();
  assert.equal(cache.size, 0);
  // After a logout there is no scope until the next profile arrives.
  await dashboard.load(past());
  assert.equal(backend.calls.length, 2);
  assert.equal(cache.size, 0);
});

// ---------------------------------------------------------------- errors

for (const status of [500, 502, 503])
  test(`a failed «Actualizar» (${status}) keeps the previous data and says so`, async () => {
    let fail = false;
    const backend = api((filters) => {
      if (fail) throw new AdminDashboardError(status);
      return fixtureFor(filters);
    });
    const { store: dashboard } = store(backend);
    await dashboard.load();
    const previous = dashboard.getSnapshot().data;
    fail = true;
    await dashboard.refresh();
    const snapshot = dashboard.getSnapshot();
    assert.equal(snapshot.data, previous);
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.refreshError, DASHBOARD_REFRESH_FAILED);
    assert.equal(snapshot.loading, false);
    fail = false;
    await dashboard.refresh();
    assert.equal(dashboard.getSnapshot().refreshError, null);
  });

for (const status of [401, 403])
  test(`a denial (${status}) on «Actualizar» withdraws the data and empties the cache`, async () => {
    let fail = false;
    const backend = api((filters) => {
      if (fail) throw new AdminDashboardError(status);
      return fixtureFor(filters);
    });
    const { store: dashboard, cache } = store(backend);
    await dashboard.load(past());
    assert.equal(cache.size, 1);
    fail = true;
    await dashboard.refresh();
    assert.equal(dashboard.getSnapshot().data, null);
    assert.equal(dashboard.getSnapshot().error.status, status);
    assert.equal(cache.size, 0);
  });
