import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";
function render(overrides = {}) {
  const load = availabilityLoader({
    mocks: {
      [path.resolve("features/worker-history/useWorkerHistory.ts")]: {
        useWorkerHistory: () => ({
          data: workerHistoryFixture(),
          loading: false,
          refreshing: false,
          error: null,
          query: "",
          setQuery() {},
          refresh() {},
          ...overrides,
        }),
      },
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      load("features/worker-history/components/WorkerHistoryPanel.tsx")
        .WorkerHistoryPanel,
    ),
  );
}
test("history UI renders terminal labels, historical items/quantity, totals and backend order", () => {
  const markup = render();
  for (const text of [
    "Historial",
    "Juan Pérez",
    "Entregado",
    "No recogido",
    "Cancelado",
    "Almuerzo del día",
    "2×",
    "30.000",
    "19.000",
    "Total",
    "14 de octubre de 2026",
    "Hora de Bogotá",
  ])
    assert.ok(markup.includes(text), text);
  assert.ok(markup.indexOf("A91C6F2D") < markup.indexOf("B72D5A10"));
  assert.match(markup, /dateTime="2026-10-14T17:43:00Z"/);
  assert.match(markup, /12:43/);
  assert.doesNotMatch(markup, /PENDING|PREPARING|clientDocument/);
  const fractional = workerHistoryFixture();
  fractional.orders[0].total = 19000.5;
  fractional.orders[0].items[0].subtotal = 15000.5;
  const fractions = render({ data: fractional });
  assert.match(fractions, /19\.000,50/);
  assert.match(fractions, /15\.000,50/);
});

test("search has an accessible label and distinct no-match state with clear actions", () => {
  const html = render({ query: "nadie coincide" });
  assert.match(html, /type="search"/);
  assert.match(
    html,
    /<label[^>]*for="worker-history-search"[^>]*>Buscar por pedido, cliente o estado<\/label>/,
  );
  assert.match(html, /No encontramos pedidos que coincidan con tu búsqueda/);
  assert.match(html, /aria-label="Limpiar búsqueda"/);
  assert.match(html, /Ver todos los pedidos/);
  assert.doesNotMatch(html, /<article/);
  const empty = render({
    query: "nadie",
    data: { ...workerHistoryFixture(), orders: [] },
  });
  assert.match(empty, /Aún no hay pedidos finalizados hoy/);
  assert.doesNotMatch(empty, /No encontramos pedidos/);
  const loading = render({ query: "nadie", data: null, loading: true });
  assert.match(loading, /Cargando historial/);
  assert.doesNotMatch(loading, /No encontramos pedidos/);
  const withoutName = workerHistoryFixture();
  withoutName.orders[0].clientName = null;
  const unknown = render({ query: "a91c", data: withoutName });
  assert.doesNotMatch(unknown, /Juan|Usuario|<p class="clientName"/);
});
test("history clock is Bogota even when the process timezone is Tokyo", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const { formatHistoryTime } = availabilityLoader()(
      "features/worker-history/presentation.ts",
    );
    assert.match(formatHistoryTime("2026-10-14T05:43:00Z"), /12:43.*a/);
    assert.match(formatHistoryTime("2026-10-14T17:43:00Z"), /12:43.*p/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("empty state is normal and loading uses an accessible stable skeleton", () => {
  const empty = render({ data: { ...workerHistoryFixture(), orders: [] } });
  assert.match(empty, /Aún no hay pedidos finalizados hoy\./);
  assert.doesNotMatch(empty, /role="alert"/);
  const loading = render({ data: null, loading: true });
  assert.match(loading, /role="status"/);
  assert.match(loading, /Cargando historial/);
  assert.match(loading, /aria-hidden="true"/);
});
test("safe recovery, session action and forbidden denial have distinct controls", () => {
  const temporary = render({
    error: {
      status: 503,
      message: "No pudimos cargar el historial en este momento.",
    },
  });
  assert.match(temporary, /role="alert"/);
  assert.match(temporary, />Reintentar</);
  assert.match(temporary, /Datos de la última consulta/);
  const unauthorized = render({
    data: null,
    error: { status: 401, message: "Inicia sesión" },
  });
  assert.match(unauthorized, /href="\/panel\/login"/);
  const forbidden = render({
    data: null,
    error: { status: 403, message: "No tienes permisos" },
  });
  assert.doesNotMatch(forbidden, /Reintentar|Iniciar sesión/);
});
