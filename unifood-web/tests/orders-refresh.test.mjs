import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup() {
  const states = [];
  const requests = [];
  const effects = [];
  let start, tick, focus;
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
      getOrders: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    },
    setTimeout: (callback) => { start = callback; },
    setInterval: (callback) => { tick = callback; },
    clearTimeout() {}, clearInterval() {},
    window: { addEventListener: (_, callback) => { focus = callback; }, removeEventListener() {} },
  });
  loaded.exports.useOrders();
  const cleanup = effects[0]();
  start();
  return { states, requests, tick, focus, cleanup, remount() { effects[0](); start(); } };
}

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
