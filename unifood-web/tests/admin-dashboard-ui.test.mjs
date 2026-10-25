import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";
const load = availabilityLoader();
const p = load("features/admin-dashboard/presentation.ts");
const render = (name, props) =>
  renderToStaticMarkup(
    React.createElement(
      load(`features/admin-dashboard/components/${name}.tsx`)[name],
      props,
    ),
  );
test("presentation keeps exact cents, large integers, nulls and percentages distinct", () => {
  assert.equal(
    p.formatCount("900719925474099312345"),
    "900.719.925.474.099.312.345",
  );
  assert.equal(
    p.formatMoney("12345678901234567890123.45"),
    "$ 12.345.678.901.234.567.890.123,45",
  );
  assert.equal(p.formatMoney("0.00"), "$ 0,00");
  assert.equal(p.formatMoney(null), "No calculable");
  assert.equal(p.formatCount(null), "No calculable");
  assert.equal(p.formatCount("0"), "0");
  assert.equal(p.formatPercent("33.33"), "33,33 %");
  assert.equal(p.formatPercent(null), "Sin base de cálculo");
});
test("custom validation uses the backend reference date across Bogota midnight", () => {
  assert.equal(
    p.customPeriodError("2026-12-31", "2026-12-31", "2027-01-01T04:59:59Z"),
    null,
  );
  assert.match(
    p.customPeriodError("2027-01-01", "2027-01-01", "2027-01-01T04:59:59Z"),
    /posteriores/,
  );
  assert.match(
    p.customPeriodError("2024-02-30", "2024-03-01", null),
    /válidas/,
  );
  assert.match(
    p.customPeriodError("2024-01-02", "2024-01-01", null),
    /inicial/,
  );
  assert.match(p.customPeriodError("2024-01-01", "2025-01-01", null), /366/);
  assert.equal(p.customPeriodError("2024-01-01", "2024-12-31", null), null);
});
test("summary renders accurate labels, backend rate and nominal money without financial claims", () => {
  const html = render("DashboardSummary", {
    summary: adminDashboardFixture().summary,
  });
  for (const text of [
    "Pedidos recibidos",
    "Pedidos entregados",
    "Pedidos no recogidos",
    "Unidades no recogidas",
    "Valor de pedidos registrados",
    "Tasa de no recogida",
    "50,00 %",
    "$ 30,00",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, />Ingresos|>Ventas|>Pérdidas/);
});
test("trend has a zero-based proportional scale and exact accessible data for huge counts", () => {
  const data = adminDashboardFixture();
  data.trend[0].receivedOrders = "9".repeat(90);
  const g = p.chartGeometry(data.trend);
  assert.equal(g.y("0"), 240);
  assert.ok(g.y(data.trend[0].receivedOrders) >= 40);
  const html = render("OrdersTrend", { trend: data.trend });
  assert.match(html, /role="img"/);
  assert.match(html, /<desc/);
  assert.match(html, /Ver datos diarios en tabla/);
  assert.ok(html.includes(p.formatCount(data.trend[0].receivedOrders)));
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.equal(g.ticks[0], "0");
});
test("zero trend and one-day series remain visible without fabricated values", () => {
  const data = adminDashboardFixture({ empty: true });
  const html = render("OrdersTrend", { trend: data.trend });
  assert.equal(p.chartGeometry(data.trend).max.toString(), "4");
  assert.match(html, /<circle/);
  assert.match(html, /<tbody>/);
});
test("rankings keep backend order and distinguish empty from unavailable", () => {
  const ranking = adminDashboardFixture().topDeliveredProducts;
  ranking.items = [
    { ...ranking.items[0], historicalName: "Zeta" },
    { ...ranking.items[0], productId: "different", historicalName: "Alfa" },
  ];
  const html = render("ProductsRanking", { ranking });
  assert.ok(html.indexOf("Zeta") < html.indexOf("Alfa"));
  const empty = render("ProductsRanking", {
    ranking: adminDashboardFixture({ empty: true }).topDeliveredProducts,
  });
  assert.match(empty, /Sin unidades entregadas verificables/);
  assert.doesNotMatch(empty, /Ranking no disponible/);
  const unavailable = render("ProductsRanking", {
    ranking: adminDashboardFixture({ unavailable: true }).notCollectedProducts,
  });
  assert.match(unavailable, /Ranking no disponible/);
  assert.doesNotMatch(unavailable, /<table/);
});
test("no recogidos shows all-universe share and monetary sources without summing order counts", () => {
  const data = adminDashboardFixture();
  data.notCollectedProducts.hasMore = true;
  data.notCollectedProducts.omitted = {
    products: "2",
    units: "5",
    itemValue: "123.45",
  };
  const html = render("NotCollectedProducts", {
    ranking: data.notCollectedProducts,
    summary: data.summary,
  });
  for (const text of [
    "Participación",
    "100,00 %",
    "Fuera del Top 10",
    "$ 123,45",
    "no se suman",
    "subtotales históricos",
  ])
    assert.ok(html.includes(text), text);
});
test("coverage explains NOT_CHECKED, UNKNOWN, limited data and scope without leaking backend codes", () => {
  const html = render("DashboardCoverage", {
    coverage: adminDashboardFixture({ unavailable: true }).coverage,
  });
  for (const text of [
    "Cobertura limitada",
    "No comprobado",
    "no está certificada",
    "Histórico completo de la cafetería",
    "requieren atención",
    "No calculable",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /UNVERIFIED_ORDER_PROVENANCE|SELECTED_EVENT_ORDERS|SQL|PRIVATE/,
  );
});
function dashboard(state) {
  const loadedDashboard = availabilityLoader({
    mocks: {
      [path.resolve("features/admin-dashboard/useAdminDashboard.ts")]: {
        useAdminDashboard: () => ({
          filters: { range: "TODAY", rankingLimit: 10 },
          referenceAsOf: null,
          load: () => {},
          ...state,
        }),
      },
    },
  })("features/admin-dashboard/components/AdminDashboard.tsx");
  return renderToStaticMarkup(
    React.createElement(loadedDashboard.AdminDashboard),
  );
}
test("initial loading announces progress and never fabricates zero metrics", () => {
  const html = dashboard({ loading: true, data: null, error: null });
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Resumen del período|Productos más entregados/);
});
for (const status of [401, 403, 503])
  test(`HTTP ${status} provides the correct action and hides protected results`, () => {
    const html = dashboard({
      loading: false,
      data: null,
      error: { status, message: "Mensaje seguro" },
    });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Resumen del período/);
    assert.equal(html.includes("Iniciar sesión"), status === 401);
    assert.equal(html.includes("Reintentar"), status === 503);
  });
test("full dashboard renders effective server period, all sections and empty coverage honestly", () => {
  const html = dashboard({
    loading: false,
    error: null,
    data: adminDashboardFixture({ empty: true }),
  });
  for (const text of [
    "Período aplicado",
    "Colombia",
    "Valores en COP",
    "Productos no recogidos",
    "Productos más entregados",
    "no confirma ausencia total",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Próximamente|PRIVATE/);
});
