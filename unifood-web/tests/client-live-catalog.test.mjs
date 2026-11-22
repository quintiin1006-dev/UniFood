import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

const fixtures = loadTs("tests/fixtures/client-menu.ts");
const menuDomain = loadTs("features/client/domain/menu.ts");
const cartDomain = loadTs("features/client/domain/cart.ts");
const refresh = loadTs("features/client/menuRefresh.ts");
const clientErrors = loadTs("features/client/errors.ts");
const messages = loadTs("features/shared/messages.ts");

const central = () =>
  menuDomain.toCafeteriaMenu(fixtures.clientMenus[fixtures.CAFETERIA_CENTRAL]);
// Closed with products that are available: the fixture of Bloque B has none available today.
const closedMenu = () => {
  const menu = central();
  menu.cafeteria.open = false;
  return menu;
};

/** The same menu with one product's availability changed. */
function withAvailability(menu, productId, available) {
  const copy = structuredClone(menu);
  for (const category of copy.categories)
    for (const product of category.products)
      if (product.id === productId) product.available = available;
  return copy;
}
const firstAvailable = (menu) =>
  menuDomain.menuProducts(menu).find((product) => product.available);

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A clock that only moves when the test says so. */
function fakeClock() {
  let now = 0;
  const pending = [];
  return {
    timers: {
      set(callback, ms) {
        const timer = { callback, at: now + ms, done: false };
        pending.push(timer);
        return timer;
      },
      clear(handle) {
        if (handle) handle.done = true;
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = pending
          .filter((timer) => !timer.done && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.done = true;
        next.callback();
      }
      now = target;
    },
    scheduled: () => pending.filter((timer) => !timer.done).length,
  };
}

// ---------- The refresh loop: 30 s, paused while hidden, backoff on failure ----------

test("the catalogue is read every 30 s, and only while the tab is visible", async () => {
  const clock = fakeClock();
  let visible = true;
  let reads = 0;
  const refresher = refresh.createMenuRefresher({
    load: async () => {
      reads += 1;
      return { kind: "ok", menu: central() };
    },
    onResult() {},
    isVisible: () => visible,
    timers: clock.timers,
  });
  refresher.start(false);
  clock.advance(29_999);
  await flush();
  assert.equal(reads, 0);
  clock.advance(1);
  await flush();
  assert.equal(reads, 1);

  // Hidden: nothing is scheduled and nothing is read, however long it stays hidden.
  visible = false;
  refresher.visibilityChanged();
  assert.equal(clock.scheduled(), 0);
  clock.advance(10 * 60_000);
  await flush();
  assert.equal(reads, 1);

  // Back in front: read at once, then the 30 s rhythm continues.
  visible = true;
  refresher.visibilityChanged();
  await flush();
  assert.equal(reads, 2);
  clock.advance(30_000);
  await flush();
  assert.equal(reads, 3);

  refresher.stop();
  clock.advance(5 * 60_000);
  await flush();
  assert.equal(reads, 3);
});

test("the focus reads at once while visible and never while hidden", async () => {
  const clock = fakeClock();
  let visible = false;
  let reads = 0;
  const refresher = refresh.createMenuRefresher({
    load: async () => {
      reads += 1;
      return { kind: "ok", menu: central() };
    },
    onResult() {},
    isVisible: () => visible,
    timers: clock.timers,
  });
  refresher.start(true);
  await flush();
  assert.equal(reads, 0);
  refresher.refresh();
  await flush();
  assert.equal(reads, 0);
  visible = true;
  refresher.refresh();
  await flush();
  assert.equal(reads, 1);
  refresher.stop();
});

test("a failed read waits longer each time, up to five minutes, and a good read resets the wait", async () => {
  const clock = fakeClock();
  const reads = [];
  const script = [
    { kind: "error" },
    { kind: "error" },
    { kind: "ok", menu: central() },
  ];
  const refresher = refresh.createMenuRefresher({
    load: async () => {
      reads.push(script.shift() ?? { kind: "error" });
      return reads.at(-1);
    },
    onResult() {},
    isVisible: () => true,
    timers: clock.timers,
  });
  assert.equal(refresh.nextMenuRefreshDelay(0), 30_000);
  assert.equal(refresh.nextMenuRefreshDelay(1), 60_000);
  assert.equal(refresh.nextMenuRefreshDelay(2), 120_000);
  assert.equal(refresh.nextMenuRefreshDelay(9), 300_000);

  refresher.start(true);
  await flush();
  assert.equal(reads.length, 1);
  clock.advance(59_999);
  await flush();
  assert.equal(reads.length, 1);
  clock.advance(1);
  await flush();
  assert.equal(reads.length, 2);
  clock.advance(119_999);
  await flush();
  assert.equal(reads.length, 2);
  clock.advance(1);
  await flush();
  assert.equal(reads.length, 3);
  // The good read reset the wait to 30 s.
  clock.advance(30_000);
  await flush();
  assert.equal(reads.length, 4);
  refresher.stop();
});

test("a read never overlaps another: a request during a read runs once it ends", async () => {
  const clock = fakeClock();
  let reads = 0;
  let finish = null;
  const refresher = refresh.createMenuRefresher({
    load: () => {
      reads += 1;
      return new Promise((resolve) => {
        finish = () => resolve({ kind: "ok", menu: central() });
      });
    },
    onResult() {},
    isVisible: () => true,
    timers: clock.timers,
  });
  refresher.start(true);
  refresher.refresh();
  refresher.refresh();
  assert.equal(reads, 1);
  finish();
  await flush();
  assert.equal(reads, 2);
  refresher.stop();
});

// ---------- What is listed: only what can be ordered ----------

test("a product that stops being available leaves the list, and empty categories stay to say so", () => {
  const menu = central();
  const target = firstAvailable(menu);
  const updated = withAvailability(menu, target.id, false);
  const orderable = refresh.onlyAvailable(updated);
  const ids = menuDomain.menuProducts(orderable).map((product) => product.id);
  assert.ok(!ids.includes(target.id));
  assert.equal(orderable.categories.length, menu.categories.length);
  assert.ok(refresh.sameMenu(menu, structuredClone(menu)));
  assert.ok(!refresh.sameMenu(menu, updated));
});

// ---------- The home: open shows the carousel, closed shows the banner first ----------

const clientHome = (menu, extra = {}) => {
  const load = availabilityLoader({
    mocks: {
      "../hooks/useCafeteriaMenu": {
        useCafeteriaMenu: () => ({
          state: { status: "ok", menu },
          stale: false,
          retry() {},
        }),
      },
      "./FeaturedCarousel": {
        __esModule: true,
        default: ({ products }) =>
          React.createElement("div", {
            "data-carousel": products.length,
          }),
      },
      "./CafeteriaSelector": { __esModule: true, default: () => null },
      "./CafeteriaMemory": {
        RememberCafeteria: () => null,
      },
      "./ProductAddButton": { __esModule: true, default: () => null },
      "./ProductPlaceholder": { __esModule: true, default: () => null },
      // Inicio reads the cart for the daily menu plate (PR 6).
      "./ClientCartProvider": {
        useClientCart: () => ({
          cart: { cafeteriaId: null, lines: [] },
          ready: true,
          setMenu: () => true,
        }),
      },
      "next/link": {
        __esModule: true,
        default: ({ href, children, ...rest }) =>
          React.createElement("a", { href, ...rest }, children),
      },
    },
  });
  const Home = load("features/client/components/ClientHome.tsx").default;
  return renderToStaticMarkup(
    React.createElement(Home, {
      ownerId: "owner",
      fullName: null,
      siteName: "Sede",
      menu,
      ...extra,
    }),
  );
};

test("open cafeteria: the carousel is shown and the closed banner is not", () => {
  const markup = clientHome(central());
  assert.match(markup, /data-carousel="\d+"/);
  assert.doesNotMatch(markup, new RegExp(messages.CLOSED_BANNER_TITLE));
});

test("closed cafeteria: the banner comes first, the carousel is gone, and only available products are listed", () => {
  const menu = closedMenu();
  const markup = clientHome(menu);
  assert.doesNotMatch(markup, /data-carousel/);
  const banner = markup.indexOf(messages.CLOSED_BANNER_TITLE);
  assert.ok(banner > 0, "the banner is rendered");
  assert.ok(
    banner < markup.indexOf("Productos:"),
    "the banner is above the products",
  );
  assert.match(markup, /role="status"/);
  // Without an opening time the notice says only «Cafetería cerrada»: nothing is invented.
  assert.doesNotMatch(markup, /Abre /);
  // Products that are not available are never listed, even though the cafeteria is closed.
  for (const product of menuDomain
    .menuProducts(menu)
    .filter((p) => !p.available))
    assert.doesNotMatch(
      markup,
      new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
});

test("a product that stops being available leaves the page and the carousel", () => {
  const menu = central();
  const target = firstAvailable(menu);
  const updated = withAvailability(menu, target.id, false);
  const expected = menuDomain.menuProducts(
    refresh.onlyAvailable(updated),
  ).length;
  const markup = clientHome(updated);
  assert.match(markup, new RegExp(`data-carousel="${expected}"`));
  assert.doesNotMatch(
    markup,
    new RegExp(target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

// ---------- The cart: a product that stopped being available cannot be paid ----------

const cartLine = (menu, productId, extra = {}) => {
  const load = availabilityLoader({
    mocks: {
      "./ClientCartProvider": {
        useClientCart: () => ({
          cart: {
            cafeteriaId: menu.cafeteria.id,
            lines: [{ productId, quantity: 1 }],
          },
          update() {},
          remove() {},
        }),
      },
      "./ProductPlaceholder": { __esModule: true, default: () => null },
      "next/link": {
        __esModule: true,
        default: ({ href, children, ...rest }) =>
          React.createElement("a", { href, ...rest }, children),
      },
    },
  });
  const Line = load("features/client/components/CartLineItem.tsx").default;
  const product = menuDomain.findProduct(menu, productId) ?? null;
  return renderToStaticMarkup(
    React.createElement(Line, {
      line: { productId, quantity: 1 },
      product,
      menu,
      ...extra,
    }),
  );
};

test("a cart line whose product is no longer available says so and can still be removed", () => {
  const menu = central();
  const target = firstAvailable(menu);
  const updated = withAvailability(menu, target.id, false);
  const markup = cartLine(updated, target.id);
  assert.match(markup, new RegExp(messages.CART_LINE_UNAVAILABLE));
  assert.match(markup, /aria-label="Eliminar /);
});

test("while such a product is in the cart the payment is blocked with its reason", () => {
  const menu = central();
  const target = firstAvailable(menu);
  const updated = withAvailability(menu, target.id, false);
  const cart = {
    cafeteriaId: menu.cafeteria.id,
    lines: [{ productId: target.id, quantity: 1 }],
  };
  const issue = cartDomain.validateCart(cart, updated);
  assert.equal(typeof issue, "string");
  assert.match(issue, /no está disponible/);
  // Removing the line unblocks the payment again.
  const emptied = { cafeteriaId: menu.cafeteria.id, lines: [] };
  assert.notEqual(cartDomain.validateCart(emptied, updated), null);
});

test("a closed cafeteria blocks the payment with the closed reason", () => {
  const closed = closedMenu();
  const available = firstAvailable(closed);
  const cart = {
    cafeteriaId: closed.cafeteria.id,
    lines: [{ productId: available.id, quantity: 1 }],
  };
  assert.equal(
    cartDomain.validateCart(cart, closed),
    cartDomain.CLOSED_MESSAGE,
  );
});

test("the backend refusal of an unavailable product is a catalogue message that leads back to the cart", () => {
  const failure = clientErrors.describeOrderError(409, "PRODUCT_UNAVAILABLE");
  assert.equal(
    failure.message,
    messages.BACKEND_ERROR_MESSAGES.PRODUCT_UNAVAILABLE,
  );
  assert.equal(failure.action, "cart");
  assert.equal(failure.newKey, false);
});

// ---------- The hook keeps the rules above in the browser ----------

test("the hook refreshes on visibility and focus and never shows loading again once a menu is on screen", () => {
  const source = fs.readFileSync(
    "features/client/hooks/useCafeteriaMenu.ts",
    "utf8",
  );
  assert.match(source, /createMenuRefresher/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /visibilityState !== "hidden"/);
  // A refresh failure keeps the menu and only marks it stale; it never replaces it with an error.
  assert.match(source, /stale: true/);
  // The server's menu seeds the state, so the first screen makes no request of its own.
  assert.match(
    source,
    /refresher\.start\(!\(seed && seed\.cafeteria\.id === id\)\)/,
  );
});
