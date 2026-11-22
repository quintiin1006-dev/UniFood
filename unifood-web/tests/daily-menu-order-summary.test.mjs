import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 8 (docs/propuesta-menu-dinamico.md 3.5 and 4.7): the plate of an order, read and drawn.

const load = availabilityLoader();
const summary = load("features/daily-menu/orderSummary.ts");
const { toClientOrder } = load("features/client-orders/contracts.ts");
const { mapBackendOrder } = load("features/orders/utils/orderMapper.ts");
const { DailyMenuSummary } = load(
  "features/daily-menu/components/DailyMenuSummary.tsx",
);

// ClientOrderResponse: prices as decimal strings.
const clientPlate = {
  title: "Almuerzo del día",
  price: "9500.00",
  choices: [
    {
      category: "Proteína",
      kind: "OPTION",
      label: "Pollo a la plancha",
      extraPrice: null,
    },
    { category: "Principio", kind: "OPTION", label: "Arroz", extraPrice: null },
    { category: "Complementos", kind: "NONE", label: null, extraPrice: null },
    {
      category: "Adiciones",
      kind: "ADDITION",
      label: "Huevo frito",
      extraPrice: "2000.00",
    },
    {
      category: "Adiciones",
      kind: "ADDITION",
      label: "Pechuga",
      extraPrice: "1500.00",
    },
  ],
};
// OrderResponse of the worker: the same plate with numbers.
const workerPlate = {
  ...clientPlate,
  price: 9500.0,
  choices: clientPlate.choices.map((choice) => ({
    ...choice,
    extraPrice: choice.extraPrice === null ? null : Number(choice.extraPrice),
  })),
};

test("prices as strings (client) and as numbers (worker) read to the same plate", () => {
  const fromClient = summary.toOrderPlate(clientPlate);
  const fromWorker = summary.toOrderPlate(workerPlate);
  assert.deepEqual(fromClient, fromWorker);
  assert.equal(fromClient.price, 9500);
  assert.equal(fromClient.choices[3].extraPrice, 2000);
  assert.equal(summary.readPrice("9500.00"), 9500);
  assert.equal(summary.readPrice(9500), 9500);
  for (const bad of ["9.500", "-1", "", null, undefined, Number.NaN, -5, "1e3"])
    assert.equal(summary.readPrice(bad), null, String(bad));
});

test("an absent, null or malformed dailyMenu is no plate: the order looks as before", () => {
  assert.equal(summary.toOrderPlate(undefined), null);
  assert.equal(summary.toOrderPlate(null), null);
  assert.equal(summary.toOrderPlate({ ...clientPlate, title: "" }), null);
  assert.equal(summary.toOrderPlate({ ...clientPlate, price: "x" }), null);
  assert.equal(
    summary.toOrderPlate({
      ...clientPlate,
      choices: [{ category: "Proteína", kind: "OTHER", label: "x" }],
    }),
    null,
  );
  assert.equal(
    summary.toOrderPlate({
      ...clientPlate,
      choices: [
        {
          category: "Adiciones",
          kind: "ADDITION",
          label: "Huevo",
          extraPrice: null,
        },
      ],
    }),
    null,
  );
});

test("the ticket: one line per category in order, «Ninguna» shown, additions together", () => {
  const ticket = summary.plateSummary(summary.toOrderPlate(clientPlate));
  assert.equal(ticket.title, "Almuerzo del día");
  assert.deepEqual(ticket.lines, [
    { category: "Proteína", value: "Pollo a la plancha" },
    { category: "Principio", value: "Arroz" },
    { category: "Complementos", value: "Ninguna" },
  ]);
  assert.deepEqual(ticket.additions, {
    category: "Adiciones",
    items: [
      { label: "Huevo frito", extraPrice: 2000 },
      { label: "Pechuga", extraPrice: 1500 },
    ],
  });
  const plain = summary.plateSummary(
    summary.toOrderPlate({
      ...clientPlate,
      choices: clientPlate.choices.slice(0, 2),
    }),
  );
  assert.equal(plain.additions, null, "without additions, no additions line");
});

test("DailyMenuSummary draws the ticket and nothing without a plate", () => {
  const html = renderToStaticMarkup(
    React.createElement(DailyMenuSummary, {
      order: { dailyMenu: summary.toOrderPlate(clientPlate), items: [] },
    }),
  );
  assert.match(html, /aria-label="Menú del día"/);
  assert.match(html, /<strong>Almuerzo del día<\/strong>/);
  assert.match(html, /<dt>Complementos:<\/dt><dd>Ninguna<\/dd>/);
  assert.match(
    html,
    /<dt>Adiciones:<\/dt><dd>Huevo frito \(\+\$\s2\.000\), Pechuga \(\+\$\s1\.500\)<\/dd>/,
  );
  assert.doesNotMatch(html, /Total del pedido/);
  for (const dailyMenu of [undefined, null])
    assert.equal(
      renderToStaticMarkup(
        React.createElement(DailyMenuSummary, {
          order: { dailyMenu, items: [] },
        }),
      ),
      "",
    );
});

test("plate-only order in the worker's detail: the total is shown, never hidden", () => {
  const order = {
    dailyMenu: summary.toOrderPlate(workerPlate),
    total: 13000,
    items: [],
  };
  const html = renderToStaticMarkup(
    React.createElement(DailyMenuSummary, { order, withTotal: true }),
  );
  assert.match(html, /Total del pedido<\/span><strong>\$\s13\.000<\/strong>/);
  // Several lines: the detail already shows its total, no second one here.
  const several = renderToStaticMarkup(
    React.createElement(DailyMenuSummary, {
      order: { ...order, items: [{ quantity: 1 }, { quantity: 1 }] },
      withTotal: true,
    }),
  );
  assert.doesNotMatch(several, /Total del pedido/);
});

test("client history never says «0 unidades»: a plate-only order shows only its total", () => {
  assert.equal(summary.historyUnitsText(0), null);
  assert.equal(summary.historyUnitsText(1), "1 unidad");
  assert.equal(summary.historyUnitsText(3), "3 unidades");
  assert.equal(summary.historyUnitsText(-1), null);
});

test("the client contract accepts the plate and keeps orders without one as today", () => {
  const base = {
    id: "00000000-0000-0000-0000-000000000051",
    status: "PENDING",
    total: "11500.00",
    note: null,
    createdAt: "2026-11-20T17:00:00Z",
    items: [],
    cafeteria: { id: "00000000-0000-0000-0000-000000000031", name: "Central" },
    cancellationSource: null,
    rejectionReason: null,
    reminderCount: 0,
  };
  const withPlate = toClientOrder({ ...base, dailyMenu: clientPlate });
  assert.equal(withPlate.dailyMenu.price, 9500);
  assert.equal(withPlate.items.length, 0, "a plate-only order is valid");
  assert.equal(toClientOrder(base).dailyMenu, null);
  assert.equal(toClientOrder({ ...base, dailyMenu: null }).dailyMenu, null);
});

test("the worker mapper accepts the plate and leaves orders without one unchanged", () => {
  const backend = {
    id: "o1",
    cafeteriaId: "c1",
    clientId: null,
    clientName: "Ana Torres",
    clientCode: null,
    clientType: null,
    status: "PENDING",
    total: 13000,
    createdAt: "2026-11-20T16:00:00Z",
    updatedAt: "2026-11-20T16:00:00Z",
    items: [],
    note: null,
  };
  assert.equal(
    mapBackendOrder({ ...backend, dailyMenu: workerPlate }).dailyMenu.title,
    "Almuerzo del día",
  );
  assert.equal("dailyMenu" in mapBackendOrder(backend), false);
  assert.equal(
    "dailyMenu" in mapBackendOrder({ ...backend, dailyMenu: null }),
    false,
  );
});

test("Llamadas units: «1 plato» with a plate, exactly as today without one", () => {
  assert.equal(summary.orderUnitsText(0, true), "1 plato");
  assert.equal(summary.orderUnitsText(1, true), "1 plato y 1 unidad");
  assert.equal(summary.orderUnitsText(3, true), "1 plato y 3 unidades");
  assert.equal(summary.orderUnitsText(0, false), "0 unidades");
  assert.equal(summary.orderUnitsText(1, false), "1 unidad");
  assert.equal(summary.orderUnitsText(2, false), "2 unidades");
  const plate = summary.toOrderPlate(workerPlate);
  assert.equal(summary.showsNoProducts({ items: [], dailyMenu: plate }), false);
  assert.equal(summary.showsNoProducts({ items: [] }), true);
  assert.equal(summary.showsNoProducts({ items: [], dailyMenu: null }), true);
  assert.equal(
    summary.showsNoProducts({ items: [{ quantity: 1 }], dailyMenu: plate }),
    false,
  );
});
