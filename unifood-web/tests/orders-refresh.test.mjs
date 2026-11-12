import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(enabled = true) {
  const states = [];
  const requests = [];
  const effects = [];
  let start, tick, focus, visibility;
  const document = {
    visibilityState: "visible",
    addEventListener: (type, callback) => { if (type === "visibilitychange") visibility = callback; },
    removeEventListener: (type, callback) => { if (type === "visibilitychange" && visibility === callback) visibility = undefined; },
  };
  const loaded = { exports: {} };
  const react = {
    useState(value) {
      const index = states.push(value) - 1;
      return [value, (next) => { states[index] = next; }];
    },
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  };
  const source = ts.transpileModule(fs.readFileSync("features/orders/hooks/useOrders.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module: loaded, exports: loaded.exports, Error,
    require: (name) => name === "react" ? react : {
      getOperationalOrders: () => new Promise((resolve, reject) => requests.push({ resolve: (orders) => resolve({orders,nextBusinessDateAt:null}), reject })),
    },
    setTimeout: (callback) => { start = callback; },
    setInterval: (callback) => { tick = callback; },
    clearTimeout() {}, clearInterval() {},
    window: { addEventListener: (_, callback) => { focus = callback; }, removeEventListener() {} },
    document,
  });
  loaded.exports.useOrders(enabled);
  const cleanup = effects[0]();
  start?.();
  return {
    states, requests, tick, focus, cleanup, document,
    get visibility() { return visibility; },
    remount() { effects[0](); start(); },
  };
}

test("inactive order modules install no polling or focus listener", () => {
  const app = setup(false);
  assert.equal(app.requests.length, 0);
  assert.equal(app.tick, undefined);
  assert.equal(app.focus, undefined);
  assert.equal(app.visibility, undefined);
});

test("slow order responses survive polling ticks and focus events", async () => {
  const app = setup();
  app.tick(); app.tick(); app.focus();
  assert.equal(app.requests.length, 1);
  const orders = [{ id: "slow-order" }];
  app.requests[0].resolve(orders);
  await new Promise(setImmediate);
  assert.equal(app.states[0], orders);
  assert.equal(app.states[1], false);
  app.tick();
  assert.equal(app.requests.length, 2);
});

test("a slow failure leaves loading and a later poll can recover", async () => {
  const app = setup();
  app.tick();
  app.requests[0].reject(new Error("No se pudo conectar"));
  await new Promise(setImmediate);
  assert.equal(app.states[1], false);
  assert.equal(app.states[2], "No se pudo conectar");
  app.tick();
  app.requests[1].resolve([]);
  await new Promise(setImmediate);
  assert.equal(app.states[2], null);
});

test("effect cleanup invalidates old responses without blocking a remount", async () => {
  const app = setup();
  app.cleanup();
  app.remount();
  assert.equal(app.requests.length, 2);
  app.requests[0].resolve([{ id: "stale" }]);
  await new Promise(setImmediate);
  assert.equal(app.states[0].length, 0);
  assert.equal(app.states[1], true);
  app.tick();
  assert.equal(app.requests.length, 2);
  const orders = [{ id: "current" }];
  app.requests[1].resolve(orders);
  await new Promise(setImmediate);
  assert.equal(app.states[0], orders);
  assert.equal(app.states[1], false);
});

test("a hidden tab does not poll and becoming visible reloads at once", async () => {
  const app = setup();
  app.requests[0].resolve([]);
  await new Promise(setImmediate);
  app.document.visibilityState = "hidden";
  app.tick(); app.tick(); app.focus(); app.visibility();
  assert.equal(app.requests.length, 1);
  app.document.visibilityState = "visible";
  app.visibility();
  assert.equal(app.requests.length, 2);
  const orders = [{ id: "after-return" }];
  app.requests[1].resolve(orders);
  await new Promise(setImmediate);
  assert.equal(app.states[0], orders);
  app.tick();
  assert.equal(app.requests.length, 3);
});

test("cleanup removes the visibility listener", () => {
  const app = setup();
  assert.equal(typeof app.visibility, "function");
  app.cleanup();
  assert.equal(app.visibility, undefined);
});
