import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// docs/ui-paneles.md, PR 1 of the worker: truthful listing states (W1, W2, W5, W6, W8, W11,
// L1 and L2).

const load = () => availabilityLoader();
const status = () => load()("features/orders/listingStatus.ts");

const order = (n, overrides = {}) => ({
  id: `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`,
  student: `Cliente ${n}`,
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
  status: "pending",
  ...overrides,
});

const render = (file, name, props) => {
  const mod = load()(file);
  return renderToStaticMarkup(
    React.createElement(name ? mod[name] : mod.default, props),
  );
};

test("listing errors get a fixed message and the right next step by status", () => {
  const { listingErrorView, listingFailure, LISTING_FORBIDDEN_MESSAGE } =
    status();
  const login = listingErrorView({ status: 401 });
  assert.equal(login.action, "login");
  assert.equal(login.withdraw, true);
  const forbidden = listingErrorView({ status: 403 });
  assert.equal(forbidden.message, LISTING_FORBIDDEN_MESSAGE);
  assert.equal(forbidden.action, "none");
  assert.equal(forbidden.withdraw, true);
  for (const code of [502, 503, null]) {
    const view = listingErrorView({ status: code });
    assert.equal(view.action, "retry");
    assert.equal(view.withdraw, false);
    assert.match(view.message, /Lo seguimos intentando/);
  }
  assert.deepEqual(
    listingFailure(Object.assign(new Error("x"), { status: 502 })),
    {
      status: 502,
    },
  );
  assert.deepEqual(listingFailure(new TypeError("Failed to fetch")), {
    status: null,
  });
});

test("the header status tells the last successful read instead of a fixed «En línea»", () => {
  const { syncStatusLabel } = status();
  assert.deepEqual(syncStatusLabel(null, false), {
    text: "Conectando…",
    tone: "pending",
  });
  // 17:43 UTC is 12:43 in Bogotá.
  assert.deepEqual(syncStatusLabel(Date.parse("2026-11-20T17:43:10Z"), false), {
    text: "Actualizado a las 12:43",
    tone: "ok",
  });
  assert.equal(syncStatusLabel(Date.now(), true).tone, "warning");
  assert.match(syncStatusLabel(Date.now(), true).text, /Sin conexión/);
});

test("announcements name the client and the new state", () => {
  const { transitionAnnouncement, newOrderAnnouncement } = status();
  assert.equal(
    transitionAnnouncement("Laura Gómez", "preparing"),
    "Pedido de Laura Gómez: en preparación.",
  );
  assert.equal(
    transitionAnnouncement("Laura Gómez", "called"),
    "Pedido de Laura Gómez: cliente llamado.",
  );
  assert.equal(newOrderAnnouncement("Ana"), "Nuevo pedido de Ana.");
});

test("error, loading, stale and search states render accessible fixed texts", () => {
  const file = "features/orders/components/BoardFeedback.tsx";
  const { listingErrorView } = status();
  const retry = render(file, "BoardError", {
    view: listingErrorView({ status: 502 }),
    retrying: false,
    onRetry() {},
  });
  assert.match(retry, /role="alert"/);
  assert.match(retry, />Reintentar</);
  const login = render(file, "BoardError", {
    view: listingErrorView({ status: 401 }),
    retrying: false,
    onRetry() {},
  });
  assert.match(login, /href="\/panel\/login"/);
  assert.doesNotMatch(login, /Reintentar/);
  const forbidden = render(file, "BoardError", {
    view: listingErrorView({ status: 403 }),
    retrying: false,
    onRetry() {},
  });
  assert.match(forbidden, /No se pudo resolver la cafetería de tu cuenta\./);
  assert.doesNotMatch(forbidden, /Reintentar|Iniciar sesión/);
  assert.match(
    render(file, "BoardLoading", {}),
    /role="status".*Cargando pedidos/,
  );
  const stale = render(file, "StaleListingBanner", {
    retrying: true,
    onRetry() {},
  });
  assert.match(stale, /Se muestran los últimos datos/);
  assert.match(stale, /Reintentando…/);
  const search = render(file, "SearchEmpty", {
    query: "  zzz ",
    scope: "por entregar",
    onClear() {},
  });
  assert.match(search, /Ningún pedido por entregar coincide con “zzz”\./);
  assert.match(search, />Limpiar búsqueda</);
  assert.match(
    render(file, "BoardAnnouncer", { message: "Nuevo pedido de Ana." }),
    /aria-live="polite"[^>]*>Nuevo pedido de Ana\.</,
  );
});

test("Entregados lists every delivery of today, not only the last five (W6)", () => {
  const delivered = Array.from({ length: 8 }, (_, i) =>
    order(i + 1, {
      status: "delivered",
      deliveredAt: `2026-11-20T1${i}:00:00Z`,
    }),
  );
  const html = render("components/worker/KanbanBoard.tsx", null, {
    orders: delivered,
    busyOrderIds: [],
    newOrderIds: {},
    now: Date.parse("2026-11-20T20:00:00Z"),
    onOpenOrder() {},
    onAction() {},
  });
  assert.equal((html.match(/Pedido entregado/g) ?? []).length >= 8, true);
  assert.match(html, />8</);
});

test("a new order shows a static «Nuevo» badge for one minute (W11)", () => {
  const now = Date.parse("2026-11-20T20:00:00Z");
  const props = (seenAt) => ({
    orders: [order(1)],
    busyOrderIds: [],
    newOrderIds: { [order(1).id]: seenAt },
    now,
    onOpenOrder() {},
    onAction() {},
  });
  const fresh = render(
    "components/worker/KanbanBoard.tsx",
    null,
    props(now - 5000),
  );
  assert.match(fresh, />Nuevo</);
  const old = render(
    "components/worker/KanbanBoard.tsx",
    null,
    props(now - 61_000),
  );
  assert.doesNotMatch(old, />Nuevo</);
});

test("an empty calls list says so instead of an empty area (L2)", () => {
  const html = render("components/worker/CallsBoard.tsx", null, {
    orders: [],
    busyOrderIds: [],
    busyActions: {},
    now: Date.now(),
    selectedOrder: null,
    search: "",
    onSearchChange() {},
    onClearSearch() {},
    onSelectOrder() {},
    onDeliver() {},
    onRemind() {},
    onNotCollected() {},
  });
  assert.match(html, /No hay pedidos esperando entrega\./);
  const searching = render("components/worker/CallsBoard.tsx", null, {
    orders: [],
    busyOrderIds: [],
    busyActions: {},
    now: Date.now(),
    selectedOrder: null,
    search: "zzz",
    onSearchChange() {},
    onClearSearch() {},
    onSelectOrder() {},
    onDeliver() {},
    onRemind() {},
    onNotCollected() {},
  });
  assert.match(searching, /Ningún pedido por entregar coincide con “zzz”\./);
});
