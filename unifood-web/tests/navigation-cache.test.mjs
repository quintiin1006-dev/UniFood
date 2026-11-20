import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

// jj/cliente-ajustes-2 · A: switching modules paints the last known data at once.

const read = (file) => fs.readFileSync(file, "utf8");

test("session stores are kept per key and dropped on sign-out", () => {
  const { sessionStore, dropSessionStores, clearSessionStores } = loadTs(
    "features/shared/sessionStore.ts",
  );
  let created = 0;
  const make = () => ({ id: ++created });
  const a = sessionStore("worker:ana:history", make);
  assert.equal(sessionStore("worker:ana:history", make), a);
  // Another account never gets the first one's store.
  assert.notEqual(sessionStore("worker:luis:history", make), a);
  dropSessionStores("worker:ana:");
  assert.notEqual(sessionStore("worker:ana:history", make), a);
  clearSessionStores();
  assert.equal(sessionStore("worker:luis:history", make).id, created);
  assert.match(
    read("features/auth/components/LogoutButton.tsx"),
    /clearSessionStores\(\);\s*window\.location\.replace/,
  );
});

test("the worker module stores are per account and still stop their timers on unmount", () => {
  const session = read("features/worker-ui/session.ts");
  assert.match(session, /`worker:\$\{account\}:\$\{module\}`/);
  assert.match(
    read("app/worker/page.tsx"),
    /<WorkerDashboard userId=\{profile\.id\} \/>/,
  );
  assert.match(
    read("components/worker/WorkerDashboard.tsx"),
    /<WorkerSessionContext\.Provider value=\{userId\}>/,
  );
  for (const [file, module] of [
    ["features/worker-history/useWorkerHistory.ts", "history"],
    ["features/availability/useAvailability.ts", "availability"],
    ["features/worker-profile/useWorkerProfile.ts", "profile"],
  ]) {
    const source = read(file);
    assert.match(
      source,
      new RegExp(String.raw`useWorkerStore\(\s*"${module}"`),
      file,
    );
    assert.doesNotMatch(source, /useState\(\(\) => new /, file);
    // Hidden modules do not keep polling.
    assert.match(source, /store\.dispose/, file);
  }
});

test("a worker profile refresh keeps what is on screen; the history does not reload with data", () => {
  assert.match(
    read("features/worker-profile/state.ts"),
    /loading: this\.state\.data === null/,
  );
  assert.match(
    read("features/worker-history/state.ts"),
    /loading: !this\.state\.data,/,
  );
  // Each module comes back at its scroll position.
  const dashboard = read("components/worker/WorkerDashboard.tsx");
  assert.match(
    dashboard,
    /scrolls\.current\[activeModule\] = mainRef\.current\?\.scrollTop/,
  );
  assert.match(
    dashboard,
    /mainRef\.current\.scrollTop = scrolls\.current\[activeModule\]/,
  );
});

test("the client keeps dynamic pages 30 s and invalidates them after placing an order", () => {
  assert.match(read("next.config.ts"), /staleTimes: \{ dynamic: 30 \}/);
  assert.match(
    read("features/client/components/ClientCheckout.tsx"),
    /setPlaced\(order\);[\s\S]{0,160}router\.refresh\(\);/,
  );
  // Signing in, out and accepting the terms are full page loads.
  assert.match(
    read("features/auth/components/AcceptTermsForm.tsx"),
    /window\.location\.assign/,
  );
  const order = read("features/client-orders/useCurrentOrder.ts");
  assert.match(order, /sessionStore\("client:current-order"/);
  assert.match(
    order,
    /useState<CurrentOrderState>\(\s*\(\) => lastState\(\)\.value \?\? INITIAL/,
  );
  // A failure is never kept.
  assert.match(order, /state\.loaded && !state\.failure/);
});
