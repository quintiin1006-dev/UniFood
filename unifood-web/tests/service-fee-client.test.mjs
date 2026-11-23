import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Service fee in the client and the worker (docs/modelo-de-negocio.md, PR 2): the browser shows
// the fee it receives, never computes it; a fee of 0, or the flag off, shows nothing new.

const CAFETERIA = "00000000-0000-0000-0000-000000000031";
const JUICE = "00000000-0000-0000-0000-000000000041";
const KEY = "key-0123456789abcdef";
const client = {
  accessToken: "verified-session-token",
  profile: { id: "client", active: true, roles: ["CLIENT"] },
};
const NBSP = /[  ]/g;
const plain = (html) => html.replace(NBSP, " ");

const load = (options = {}) => availabilityLoader(options);
const render = (file, props, name) => {
  const mod = load()(file);
  return plain(
    renderToStaticMarkup(
      React.createElement(name ? mod[name] : mod.default, props),
    ),
  );
};

// ---------------------------------------------------------------- presentation

test("the fee is read as whole pesos from the menu or the order, anything else is 0", () => {
  const { readServiceFee, feeBreakdown } = load()(
    "features/service-fee/presentation.ts",
  );
  assert.equal(readServiceFee(300), 300);
  assert.equal(readServiceFee("300.00"), 300);
  assert.equal(readServiceFee("0.00"), 0);
  assert.equal(readServiceFee(2000), 2000);
  for (const bad of [2001, -1, 1.5, "300.50", "abc", null, undefined, {}])
    assert.equal(readServiceFee(bad), 0, String(bad));
  assert.deepEqual(feeBreakdown(9300, 300), {
    products: 9000,
    serviceFee: 300,
  });
  assert.equal(feeBreakdown(9000, 0), null);
  assert.equal(feeBreakdown(200, 300), null);
});

test("after a 409 the fee Spring answered with wins until the menu brings its own", () => {
  const { shownServiceFee } = load()("features/service-fee/checkout.ts");
  assert.equal(shownServiceFee(null, null), null);
  assert.equal(shownServiceFee(300, null), 300);
  const override = { value: 400, menuFee: 300 };
  assert.equal(shownServiceFee(300, override), 400);
  // The menu read again carries the new value: it wins from then on.
  assert.equal(shownServiceFee(400, override), 400);
  assert.equal(shownServiceFee(500, override), 500);
});

// ---------------------------------------------------------------- menu and order body

test("the menu carries the fee only when Spring sends it", () => {
  const { toCafeteriaMenu } = load()("features/client/domain/menu.ts");
  const base = {
    cafeteria: { id: CAFETERIA, name: "Cafetería Central", open: true },
    businessDate: "2026-11-20",
    categories: [],
  };
  assert.equal(toCafeteriaMenu(base).serviceFee, null);
  assert.equal(toCafeteriaMenu({ ...base, serviceFee: 300 }).serviceFee, 300);
  assert.equal(toCafeteriaMenu({ ...base, serviceFee: 0 }).serviceFee, 0);
});

test("the order sends the fee it showed and keeps the idempotency signature", () => {
  const checkout = load()("features/client/domain/checkout.ts");
  const cart = {
    cafeteriaId: CAFETERIA,
    lines: [{ productId: JUICE, quantity: 2 }],
  };
  const withFee = checkout.buildOrderRequest(cart, "", null, 300);
  assert.equal(withFee.expectedServiceFee, 300);
  const withZero = checkout.buildOrderRequest(cart, "", null, 0);
  assert.equal(withZero.expectedServiceFee, 0);
  const without = checkout.buildOrderRequest(cart, "", null);
  assert.equal("expectedServiceFee" in without, false);
  // A changed fee is a 409 that writes nothing: the same key stays valid.
  assert.equal(
    checkout.orderSignature(withFee),
    checkout.orderSignature(without),
  );
  const placed = checkout.parsePlacedOrder({
    id: "00000000-0000-0000-0000-000000000051",
    status: "PENDING",
    total: "9300.00",
    serviceFee: "300.00",
    items: [{ name: "Jugo", quantity: 2, unitPrice: "4500.00" }],
  });
  assert.equal(placed.serviceFee, 300);
  assert.equal(placed.total, 9300);
});

test("SERVICE_FEE_CHANGED keeps the cart and the key, with the agreed message", async () => {
  const { describeOrderError } = load()("features/client/errors.ts");
  const error = describeOrderError(409, "SERVICE_FEE_CHANGED");
  assert.equal(
    error.message,
    "El cargo por servicio cambió. Revisa el total y confirma de nuevo.",
  );
  assert.equal(error.action, "serviceFee");
  assert.equal(error.newKey, false);

  const { placeOrder } = load()("features/client/api/placeOrder.ts");
  const result = await placeOrder(
    { cafeteriaId: CAFETERIA, items: [], expectedServiceFee: 300 },
    KEY,
    async () =>
      Response.json(
        { code: "SERVICE_FEE_CHANGED", message: "PRIVATE", serviceFee: 400 },
        { status: 409 },
      ),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.serviceFee, 400);
  assert.equal(result.error.message.includes("PRIVATE"), false);
});

// ---------------------------------------------------------------- BFF

function bff({ environment = {}, fetchMock } = {}) {
  const calls = [];
  const loader = load({
    environment: { API_URL: "http://backend.test:8080", ...environment },
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      return fetchMock(url, options);
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => client },
    },
  });
  return {
    calls,
    menu: loader("app/api/me/menu/route.ts").GET,
    orders: loader("app/api/me/orders/route.ts").POST,
  };
}

const menuBody = {
  cafeteria: { id: CAFETERIA, name: "Cafetería Central", open: true },
  businessDate: "2026-11-20",
  categories: [],
  serviceFee: 300,
};

test("with the web flag off the menu loses its fee; on, it keeps it; always no-store", async () => {
  for (const [value, kept] of [
    [undefined, false],
    ["false", false],
    ["nonsense", false],
    ["true", true],
  ]) {
    const { menu } = bff({
      environment: value === undefined ? {} : { SERVICE_FEE_ENABLED: value },
      fetchMock: async () =>
        Response.json(menuBody, {
          headers: { "cache-control": "no-store, private", etag: '"e"' },
        }),
    });
    const response = await menu(
      new Request(`http://browser.test/api/me/menu?cafeteriaId=${CAFETERIA}`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const body = await response.json();
    assert.equal("serviceFee" in body, kept, String(value));
  }
});

const post = (body) =>
  new Request("http://browser.test/api/me/orders", {
    method: "POST",
    headers: {
      host: "browser.test",
      origin: "http://browser.test",
      "content-type": "application/json",
      "idempotency-key": KEY,
    },
    body: JSON.stringify(body),
  });
const order = (extra = {}) => ({
  cafeteriaId: CAFETERIA,
  items: [{ productId: JUICE, quantity: 2 }],
  ...extra,
});

test("the order BFF forwards a whole expected fee and refuses anything else", async () => {
  const created = { id: "x", status: "PENDING", total: "9300.00", items: [] };
  for (const fee of [0, 300, 2000]) {
    const { calls, orders } = bff({
      fetchMock: async () => Response.json(created, { status: 201 }),
    });
    const response = await orders(post(order({ expectedServiceFee: fee })));
    assert.equal(response.status, 201);
    assert.equal(
      JSON.parse(calls[0].options.body).expectedServiceFee,
      fee,
      String(fee),
    );
  }
  const { calls: none, orders: plainOrders } = bff({
    fetchMock: async () => Response.json(created, { status: 201 }),
  });
  await plainOrders(post(order()));
  assert.equal("expectedServiceFee" in JSON.parse(none[0].options.body), false);
  for (const bad of [-1, 2001, 1.5, "300"]) {
    const { calls, orders } = bff({
      fetchMock: async () => Response.json(created, { status: 201 }),
    });
    const response = await orders(post(order({ expectedServiceFee: bad })));
    assert.equal(response.status, 400, String(bad));
    assert.equal(calls.length, 0);
  }
});

test("the 409 of Spring reaches the browser with the fee in force and no-store", async () => {
  const { orders } = bff({
    fetchMock: async () =>
      Response.json(
        {
          status: 409,
          code: "SERVICE_FEE_CHANGED",
          message:
            "El cargo por servicio cambió. Revisa el total y confirma de nuevo.",
          serviceFee: 400,
        },
        { status: 409 },
      ),
  });
  const response = await orders(post(order({ expectedServiceFee: 300 })));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, "SERVICE_FEE_CHANGED");
  assert.equal(body.serviceFee, 400);
});

test("the routes that carry the fee opt out of every Next cache", () => {
  for (const file of [
    "app/api/me/menu/route.ts",
    "app/api/me/orders/route.ts",
    "app/api/me/orders/current/route.ts",
    "app/api/me/orders/[orderId]/route.ts",
  ])
    assert.match(
      fs.readFileSync(file, "utf8"),
      /export const dynamic = "force-dynamic";/,
      file,
    );
});

test("the service worker never caches responses", () => {
  const sw = fs.readFileSync("public/sw.js", "utf8");
  assert.doesNotMatch(sw, /addEventListener\(\s*["']fetch["']/);
  assert.doesNotMatch(sw, /caches\./);
});

// ---------------------------------------------------------------- screens

const format = (amount) => `$ ${amount}`;

test("without a fee nothing new is drawn; with one, Productos and Cargo por servicio", () => {
  const empty = render(
    "features/service-fee/components/FeeLines.tsx",
    { total: 9000, serviceFee: 0, format },
    "FeeLines",
  );
  assert.equal(empty, "");
  const html = render(
    "features/service-fee/components/FeeLines.tsx",
    { total: 9300, serviceFee: 300, format },
    "FeeLines",
  );
  assert.match(html, /aria-label="Desglose del total"/);
  assert.match(html, /<dt>Productos<\/dt><dd>\$ 9000<\/dd>/);
  assert.match(html, /<dt>Cargo por servicio<\/dt><dd>\$ 300<\/dd>/);
});

test("the worker charges «Total a cobrar» with the breakdown, and only then", () => {
  const file = "features/service-fee/components/WorkerChargeTotal.tsx";
  const before = render(
    file,
    { total: 9000, serviceFee: 0, className: "t", format },
    "WorkerChargeTotal",
  );
  assert.equal(
    before,
    '<div class="t"><span>Total</span><strong>$ 9000</strong></div>',
  );
  assert.equal(
    render(
      file,
      { total: 9000, className: "t", format, show: false },
      "WorkerChargeTotal",
    ),
    "",
  );
  const charged = render(
    file,
    { total: 9300, serviceFee: 300, className: "t", format, show: false },
    "WorkerChargeTotal",
  );
  assert.match(charged, /Cargo por servicio/);
  assert.match(
    charged,
    /<span>Total a cobrar<\/span><strong>\$ 9300<\/strong>/,
  );
});

const workerOrder = (overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000091",
  student: "Laura Gómez",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [
    {
      id: "i",
      name: "Corriente",
      quantity: 1,
      unitPrice: 9000,
      subtotal: 9000,
    },
  ],
  status: "called",
  calledAt: "2026-11-20T16:30:00Z",
  total: 9300,
  serviceFee: 300,
  ...overrides,
});

test("the worker's detail and Llamadas show «Total a cobrar» with the breakdown", () => {
  const detail = render("components/worker/OrderDetail.tsx", {
    order: workerOrder(),
    onClose() {},
    onAction() {},
  });
  assert.match(detail, /Total a cobrar/);
  assert.match(detail, /Cargo por servicio/);
  // One product and one unit: before the fee the total row was hidden; now it is what is charged.
  const selected = workerOrder();
  const calls = render("components/worker/CallsBoard.tsx", {
    orders: [selected],
    busyOrderIds: [],
    busyActions: {},
    now: Date.parse("2026-11-20T16:32:00Z"),
    selectedOrder: selected,
    search: "",
    onSearchChange() {},
    onSelectOrder() {},
    onDeliver() {},
    onRemind() {},
    onNotCollected() {},
  });
  assert.match(calls, /Total a cobrar/);
  assert.match(calls, /Cargo por servicio/);
  const old = workerOrder({ serviceFee: 0, total: 9000 });
  const oldCalls = render("components/worker/CallsBoard.tsx", {
    orders: [old],
    busyOrderIds: [],
    busyActions: {},
    now: Date.parse("2026-11-20T16:32:00Z"),
    selectedOrder: old,
    search: "",
    onSearchChange() {},
    onSelectOrder() {},
    onDeliver() {},
    onRemind() {},
    onNotCollected() {},
  });
  assert.doesNotMatch(oldCalls, /Cargo por servicio|Total a cobrar/);
});

test("the worker reads the fee of Spring's order; without it, 0", () => {
  const { mapBackendOrder } = load()("features/orders/utils/orderMapper.ts");
  const backend = {
    id: "o",
    cafeteriaId: CAFETERIA,
    clientId: null,
    clientName: "Laura",
    clientCode: null,
    clientType: "STUDENT",
    status: "CALLED",
    total: 9300,
    createdAt: "2026-11-20T16:00:00Z",
    updatedAt: "2026-11-20T16:00:00Z",
    items: [],
    note: null,
  };
  assert.equal(
    mapBackendOrder({ ...backend, serviceFee: 300 }).serviceFee,
    300,
  );
  assert.equal(mapBackendOrder(backend).serviceFee, 0);
});

test("Mi pedido and its detail split the total; an order without a fee looks as before", () => {
  const { toClientOrder } = load()("features/client-orders/contracts.ts");
  const raw = {
    id: "00000000-0000-0000-0000-000000000051",
    status: "PENDING",
    total: "9300.00",
    serviceFee: "300.00",
    productsSubtotal: "9000.00",
    createdAt: "2026-11-20T17:00:00Z",
    cafeteria: { id: CAFETERIA, name: "Cafetería Central" },
    items: [
      { name: "Jugo", quantity: 2, unitPrice: "4500.00", subtotal: "9000.00" },
    ],
  };
  const order = toClientOrder(raw);
  assert.equal(order.serviceFee, 300);
  const html = render("features/client-orders/components/OrderSummary.tsx", {
    order,
  });
  assert.match(html, /Cargo por servicio/);
  assert.match(html, /Productos/);
  const old = toClientOrder({
    ...raw,
    total: "9000.00",
    serviceFee: undefined,
  });
  assert.equal(old.serviceFee, 0);
  assert.doesNotMatch(
    render("features/client-orders/components/OrderSummary.tsx", {
      order: old,
    }),
    /Cargo por servicio/,
  );
});

test("the new texts live in the shared catalogue", () => {
  const messages = load()("features/shared/messages.ts");
  assert.equal(messages.SERVICE_FEE_LABEL, "Cargo por servicio");
  assert.equal(messages.SERVICE_FEE_PRODUCTS, "Productos");
  assert.equal(messages.SERVICE_FEE_TOTAL_TO_CHARGE, "Total a cobrar");
  for (const file of [
    "features/service-fee/components/FeeLines.tsx",
    "features/service-fee/components/WorkerChargeTotal.tsx",
  ])
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      /"(Productos|Cargo por servicio|Total a cobrar)"/,
      file,
    );
});
