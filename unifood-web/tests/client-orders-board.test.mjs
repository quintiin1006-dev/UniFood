import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

const stages = loadTs("features/client-orders/stages.ts");
const messages = loadTs("features/shared/messages.ts");
const { ORDER_FLOW } = loadTs("lib/orderWorkflow.ts");

const ORDER_ID = "00000000-0000-0000-0000-00000000ab12";
const order = (status, extra = {}) => ({
  id: ORDER_ID,
  status,
  total: "12500.00",
  note: null,
  createdAt: "2026-11-17T15:20:00.000Z",
  items: [
    {
      name: "Almuerzo corriente",
      quantity: 2,
      unitPrice: "6000.00",
      subtotal: "12000.00",
    },
    {
      name: "Jugo de mango",
      quantity: 1,
      unitPrice: "500.00",
      subtotal: "500.00",
    },
  ],
  cafeteria: {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Cafetería de prueba",
  },
  cancellationSource: null,
  rejectionReason: null,
  reminderCount: 0,
  requestedPickupAt: null,
  ...extra,
});

const fs_read = (file) => fs.readFileSync(file, "utf8");
const dialogMock = {
  "@/features/client/components/ClientDialog": {
    __esModule: true,
    default: () => null,
  },
};
const html = (file, mocks = {}, props = {}) => {
  const load = availabilityLoader({ mocks });
  const Component = load(file).default;
  return renderToStaticMarkup(React.createElement(Component, props));
};

// ---------- Stages: the real flow of the backend ----------

test("the stages are the normal flow of lib/orderWorkflow, in order", () => {
  assert.equal(stages.ORDER_STAGE_COUNT, 5);
  assert.equal(stages.ORDER_STAGE_ICONS.length, stages.ORDER_STAGE_COUNT);
  assert.equal(messages.ORDER_STAGE_LABELS.length, stages.ORDER_STAGE_COUNT);
  ORDER_FLOW.forEach((status, index) => {
    assert.equal(stages.stageIndexOf(status.toUpperCase()), index, status);
  });
});

test("each state of the active flow lands on its stage; the ended ones are not stages", () => {
  assert.equal(stages.stageIndexOf("PENDING"), 0);
  assert.equal(stages.stageIndexOf("PREPARING"), 1);
  assert.equal(stages.stageIndexOf("READY"), 2);
  assert.equal(stages.stageIndexOf("CALLED"), 3);
  assert.equal(stages.stageIndexOf("DELIVERED"), 4);
  assert.equal(stages.stageIndexOf("CANCELLED"), null);
  assert.equal(stages.stageIndexOf("NOT_COLLECTED"), null);
});

test("the pickup notice is only for READY and CALLED", () => {
  for (const status of ["PENDING", "PREPARING", "DELIVERED", "CANCELLED"])
    assert.equal(stages.isPickupReady(status), false, status);
  assert.equal(stages.isPickupReady("READY"), true);
  assert.equal(stages.isPickupReady("CALLED"), true);
});

test("the pickup code is four upper-case characters of the order id and is stable", () => {
  assert.equal(stages.pickupCodeOf(ORDER_ID), "AB12");
  assert.match(stages.pickupCodeOf(ORDER_ID), /^[0-9A-F]{4}$/);
});

test("the ended orders get an icon that is not only a colour", () => {
  assert.equal(stages.historyIconOf("DELIVERED"), "exito");
  assert.equal(stages.historyIconOf("NOT_COLLECTED"), "advertencia");
  assert.equal(stages.historyIconOf("CANCELLED"), "cerrar");
});

// ---------- Board: what the student sees ----------

const board = (status, extra) =>
  html("features/client-orders/components/OrderBoard.tsx", dialogMock, {
    order: order(status, extra),
    onCancelled() {},
    onChanged() {},
  });

test("only the current stage has aria-current=step and every stage says its position in text", () => {
  const expected = {
    PENDING: 1,
    PREPARING: 2,
    READY: 3,
    CALLED: 4,
    DELIVERED: 5,
  };
  for (const [status, position] of Object.entries(expected)) {
    const markup = board(status);
    assert.equal(
      (markup.match(/aria-current="step"/g) ?? []).length,
      1,
      status,
    );
    assert.match(
      markup,
      new RegExp(`Etapa ${position} de 5, etapa actual`),
      status,
    );
    for (let n = 1; n <= 5; n += 1)
      assert.match(markup, new RegExp(`Etapa ${n} de 5`), `${status} ${n}`);
  }
});

test("the card names the order, the cafeteria and the products, without estimated time or turn number", () => {
  const markup = board("PREPARING");
  assert.match(markup, /Cafetería de prueba/);
  assert.match(markup, /2× Almuerzo corriente · 1× Jugo de mango/);
  assert.match(markup, /Total/);
  assert.match(markup, /AB12/);
  assert.doesNotMatch(markup, /estimad|turno/i);
});

test("«Tu pedido está listo, pasa a recogerlo» appears with the code for READY and CALLED only", () => {
  for (const status of ["READY", "CALLED"]) {
    const markup = board(status);
    assert.match(markup, /Tu pedido está listo, pasa a recogerlo/, status);
    assert.match(markup, /<strong>AB12<\/strong>/, status);
  }
  for (const status of ["PENDING", "PREPARING", "DELIVERED"])
    assert.doesNotMatch(board(status), /pasa a recogerlo/, status);
});

test("«Cancelar pedido» is rendered only while the order is PENDING", () => {
  assert.match(board("PENDING"), /Cancelar pedido/);
  for (const status of ["PREPARING", "READY", "CALLED", "DELIVERED"])
    assert.doesNotMatch(board(status), /Cancelar pedido/, status);
});

test("the cancel dialog is closed at first and asks for confirmation with the safe answer focused", () => {
  const source = fs_read("features/client-orders/components/OrderBoard.tsx");
  assert.match(source, /<Button variant="secondary"[^>]*autoFocus/);
  assert.match(source, /CANCEL_KEEP/);
  assert.match(
    fs_read("features/shared/messages.ts"),
    /CANCEL_KEEP = "Mantener pedido"/,
  );
  assert.match(source, /loading=\{busy\}/);
  assert.match(
    source,
    /setFailure\(outcome\.failure\);\s*\/\/[^\n]*\n\s*onStale\(\)/,
  );
  assert.match(source, /<Notice tone="error"/);
});

test("a 409 on cancel shows the catalogue message «ya no se puede cancelar» and refreshes the state", () => {
  const { cancelFailure } = loadTs("features/client-orders/errors.ts");
  assert.equal(
    cancelFailure(409, "ORDER_ALREADY_PREPARING").message,
    "Tu pedido ya no se puede cancelar.",
  );
  assert.match(
    messages.CLIENT_ORDER_NOT_CANCELLABLE,
    /ya no se puede cancelar/,
  );
  // Any other 409 is the generic «cambió de estado» and never a guess.
  assert.equal(
    cancelFailure(409, "INVALID_ORDER_STATE").message,
    messages.CLIENT_ORDER_CHANGED,
  );
});

// ---------- My order: empty state, board and history together ----------

const linkMock = {
  "next/link": {
    __esModule: true,
    default: ({ href, children, ...rest }) =>
      React.createElement("a", { href, ...rest }, children),
  },
};

const myOrderMocks = (state) => ({
  ...dialogMock,
  ...linkMock,
  "../useCurrentOrder": {
    useCurrentOrder: () => ({
      loaded: true,
      order: null,
      finished: null,
      failure: null,
      offline: false,
      refresh() {},
      ...state,
    }),
  },
  "./OrderHistory": { __esModule: true, default: () => null },
  "../sound": {
    armChime: () => () => undefined,
    playChime() {},
    readMuted: () => false,
    writeMuted() {},
  },
  "../polling": {
    ALERT_TEXT: {},
    tabTitle: () => null,
  },
});

test("without an active order the board shows the empty state with a way to the menu", () => {
  const markup = html(
    "features/client-orders/components/MyOrder.tsx",
    myOrderMocks({}),
  );
  assert.match(markup, /No tienes un pedido activo/);
  assert.match(markup, /href="\/cuenta"/);
  assert.match(markup, /Ver el menú/);
  assert.doesNotMatch(markup, /aria-current="step"/);
});

test("the active order is shown on the board above the history", () => {
  const markup = html(
    "features/client-orders/components/MyOrder.tsx",
    myOrderMocks({ order: order("READY") }),
  );
  assert.match(markup, /Etapa 3 de 5, etapa actual/);
  assert.match(markup, /Tu pedido está listo, pasa a recogerlo/);
  assert.doesNotMatch(markup, /No tienes un pedido activo/);
});

test("the history is one module with the board, under «Historial», with no separate tab", () => {
  const source = fs_read("features/client-orders/components/MyOrder.tsx");
  assert.match(
    source,
    /<OrderHistory refreshKey=\{finished\?\.id \?\? null\} \/>/,
  );
});

test("the history shows its empty state with the agreed text", () => {
  const markup = html(
    "features/client-orders/components/OrderHistory.tsx",
    {
      ...dialogMock,
      "../useOrderHistory": {
        useOrderHistory: () => ({
          orders: [],
          phase: "ready",
          hasMore: false,
          loadingMore: false,
          failure: null,
          loadMore() {},
          retry() {},
          reload() {},
        }),
      },
    },
    { refreshKey: null },
  );
  assert.match(markup, /Aún no tienes pedidos anteriores/);
  assert.doesNotMatch(markup, /repetir/i);
});

test("«Cargar más» is offered while the history has another page", () => {
  const rows = [
    {
      id: "00000000-0000-0000-0000-000000000031",
      status: "DELIVERED",
      total: "6000.00",
      createdAt: "2026-11-16T12:00:00.000Z",
      cafeteriaName: "Cafetería de prueba",
      itemCount: 1,
      summary: "Almuerzo corriente",
    },
  ];
  const mockFor = (hasMore) => ({
    ...dialogMock,
    "../useOrderHistory": {
      useOrderHistory: () => ({
        orders: rows,
        phase: "ready",
        hasMore,
        loadingMore: false,
        failure: null,
        loadMore() {},
        retry() {},
        reload() {},
      }),
    },
  });
  const props = { refreshKey: null };
  const withMore = html(
    "features/client-orders/components/OrderHistory.tsx",
    mockFor(true),
    props,
  );
  assert.match(withMore, /Cargar más/);
  assert.match(withMore, /Entregado/);
  const without = html(
    "features/client-orders/components/OrderHistory.tsx",
    mockFor(false),
    props,
  );
  assert.doesNotMatch(without, /Cargar más/);
});

test("the card keeps the student's note and the reminder to pay cash at the counter", () => {
  const markup = board("PENDING", { note: "Sin cebolla" });
  assert.match(markup, /Sin cebolla/);
  assert.match(markup, /Pagas en efectivo en caja/);
});

test("a delivered order just ended stays on the board as its last stage; a cancelled one does not", () => {
  const delivered = html(
    "features/client-orders/components/MyOrder.tsx",
    myOrderMocks({ order: null, finished: order("DELIVERED") }),
  );
  assert.match(delivered, /Etapa 5 de 5, etapa actual/);
  assert.match(delivered, /Pedido entregado/);
  const cancelled = html(
    "features/client-orders/components/MyOrder.tsx",
    myOrderMocks({
      order: null,
      finished: order("CANCELLED", { cancellationSource: "CLIENT" }),
    }),
  );
  assert.doesNotMatch(cancelled, /aria-current="step"/);
  // Outside the board: one status line with its outcome, not a stage.
  assert.match(cancelled, /Cancelaste tu pedido/);
  assert.doesNotMatch(cancelled, /No tienes un pedido activo/);
});

// ---------- Navigation: four tabs and the old address ----------

const navMarkup = () =>
  html("features/client/components/ClientBottomNav.tsx", {
    "next/navigation": {
      usePathname: () => "/cuenta/pedido",
      useSearchParams: () => new URLSearchParams(),
    },
    "next/link": {
      __esModule: true,
      default: ({ href, children, ...rest }) =>
        React.createElement("a", { href, ...rest }, children),
    },
    "./ClientCartProvider": {
      useClientCart: () => ({ count: 0, cart: { cafeteriaId: null } }),
    },
    "../domain/context": { cafeteriaHref: (id) => `/cuenta?cafeteria=${id}` },
  });

test("the bottom bar has four tabs: Inicio, Pedido, Carrito and Perfil", () => {
  const markup = navMarkup();
  const links = [...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(links.length, 4, markup);
  assert.match(markup, />Inicio</);
  assert.match(markup, />Pedido</);
  assert.match(markup, />Carrito</);
  assert.match(markup, />Perfil</);
  assert.doesNotMatch(markup, />Historial</);
  assert.ok(links.includes("/cuenta/pedido"));
  assert.ok(!links.some((href) => href.startsWith("/cuenta/historial")));
});

test("the Pedido tab is the current page on /cuenta/pedido", () => {
  const markup = navMarkup();
  assert.match(markup, /href="\/cuenta\/pedido"[^>]*aria-current="page"/);
});

test("/cuenta/historial redirects to /cuenta/pedido", () => {
  class Redirect extends Error {}
  const load = availabilityLoader({
    mocks: {
      "next/navigation": {
        redirect: (to) => {
          throw new Redirect(to);
        },
      },
    },
  });
  const page = load("app/cuenta/historial/page.tsx").default;
  assert.throws(
    () => page(),
    (error) => error instanceof Redirect && error.message === "/cuenta/pedido",
  );
});
