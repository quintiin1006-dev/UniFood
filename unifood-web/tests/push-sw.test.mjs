import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SOURCE = fs.readFileSync("public/sw.js", "utf8");
const ORIGIN = "https://unifood.example";

/** Runs public/sw.js in a fake ServiceWorkerGlobalScope and returns its handlers. */
function worker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => (listeners[type] = handler),
    skipWaiting: () => {},
    registration: {
      showNotification: async (title, options) =>
        shown.push({ title, options }),
    },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => opened.push(url),
    },
  };
  vm.runInNewContext(SOURCE, { self, URL, console });
  const dispatch = async (type, event) => {
    let pending;
    listeners[type]({ ...event, waitUntil: (promise) => (pending = promise) });
    await pending;
  };
  return { listeners, shown, opened, dispatch };
}

const pushEvent = (payload) => ({
  data: {
    json: () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  },
});

test("a push shows the notice with icon, badge, a tag per order and a short vibration", async () => {
  const sw = worker();
  await sw.dispatch(
    "push",
    pushEvent({
      title: "¡Tu pedido está listo!",
      body: "Pronto te llamarán para recogerlo.",
      tag: "unifood-order-A41B2C3D",
      url: "/cuenta/pedido",
    }),
  );
  assert.equal(sw.shown.length, 1);
  const [{ title, options }] = sw.shown;
  assert.equal(title, "¡Tu pedido está listo!");
  assert.equal(options.body, "Pronto te llamarán para recogerlo.");
  assert.equal(options.icon, "/icons/icon-192.png");
  assert.equal(options.badge, "/icons/badge-96.png");
  assert.equal(options.tag, "unifood-order-A41B2C3D");
  assert.equal(options.renotify, true);
  assert.ok(
    options.vibrate.length > 0 &&
      options.vibrate.reduce((a, b) => a + b) <= 500,
  );
  assert.equal(options.data.url, "/cuenta/pedido");
});

test("a malformed or empty payload still shows a safe generic notice", async () => {
  for (const event of [
    { data: null },
    {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
      },
    },
    pushEvent([1, 2]),
    pushEvent({ title: 42, url: 7 }),
  ]) {
    const sw = worker();
    await sw.dispatch("push", event);
    assert.equal(sw.shown[0].title, "UniFood");
    assert.equal(sw.shown[0].options.tag, "unifood");
    assert.equal(sw.shown[0].options.data.url, "/");
  }
});

test("only same-origin app pages can be opened from a notice", () => {
  const { safeUrl } = (() => {
    const self = { location: { origin: ORIGIN }, addEventListener: () => {} };
    vm.runInNewContext(SOURCE, { self, URL, console });
    return self.__unifoodPush;
  })();
  assert.equal(safeUrl("/cuenta/pedido"), "/cuenta/pedido");
  assert.equal(safeUrl("/worker"), "/worker");
  assert.equal(safeUrl(`${ORIGIN}/worker`), "/worker");
  assert.equal(safeUrl("https://evil.example/cuenta"), "/");
  assert.equal(safeUrl("//evil.example/cuenta"), "/");
  assert.equal(safeUrl("javascript:alert(1)"), "/");
  assert.equal(safeUrl("/admin"), "/");
  assert.equal(safeUrl("/cuentas-falsas"), "/");
  assert.equal(safeUrl(undefined), "/");
});

test("tapping a notice focuses the open page, else reuses a window, else opens one", async () => {
  const focused = [];
  const exact = {
    url: `${ORIGIN}/cuenta/pedido`,
    focus: async () => focused.push("exact"),
  };
  let sw = worker({ windows: [exact] });
  let closed = 0;
  const click = (url) => ({
    notification: { data: { url }, close: () => closed++ },
  });
  await sw.dispatch("notificationclick", click("/cuenta/pedido"));
  assert.deepEqual(focused, ["exact"]);
  assert.equal(closed, 1);

  const navigated = [];
  const other = {
    url: `${ORIGIN}/cuenta`,
    focus: async () => focused.push("other"),
    navigate: async (url) => navigated.push(url),
  };
  sw = worker({ windows: [other] });
  await sw.dispatch("notificationclick", click("/cuenta/pedido"));
  assert.deepEqual(navigated, [`${ORIGIN}/cuenta/pedido`]);

  sw = worker();
  await sw.dispatch("notificationclick", click("https://evil.example"));
  assert.deepEqual(sw.opened, [`${ORIGIN}/`]);
});

test("the service worker never intercepts requests nor caches anything", () => {
  const sw = worker();
  assert.equal(sw.listeners.fetch, undefined);
  assert.doesNotMatch(SOURCE, /addEventListener\(\s*["']fetch["']/);
  assert.doesNotMatch(SOURCE, /\bcaches\b/);
  assert.doesNotMatch(SOURCE, /importScripts/);
});
