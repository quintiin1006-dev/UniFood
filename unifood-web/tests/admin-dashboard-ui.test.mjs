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
test("presentation rounds to whole pesos and one-decimal percentages without losing large integers", () => {
  assert.equal(
    p.formatCount("900719925474099312345"),
    "900.719.925.474.099.312.345",
  );
  assert.equal(
    p.formatMoney("12345678901234567890123.45"),
    "$12.345.678.901.234.567.890.123",
  );
  assert.equal(p.formatMoney("0.00"), "$0");
  assert.equal(p.formatMoney("22500.50"), "$22.501");
  assert.equal(p.formatMoney("22500.49"), "$22.500");
  assert.equal(p.formatMoney(null), "No calculable");
  assert.equal(p.formatCount(null), "No calculable");
  assert.equal(p.formatCount("0"), "0");
  assert.equal(p.formatPercent("33.33"), "33,3 %");
  assert.equal(p.formatPercent("100.00"), "100 %");
  assert.equal(p.formatPercent("12.35"), "12,4 %");
  assert.equal(p.formatPercent("0.04"), "0 %");
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
    "50 %",
    "$30",
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/class="metric"/g) ?? []).length, 5);
  assert.match(html, /class="monetarySummary"/);
  assert.doesNotMatch(html, /Valor asociado a no recogidos/);
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
  assert.match(html, /height="0"/);
  assert.equal((html.match(/data-count="0"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<circle|<polyline/);
  assert.match(html, /<tbody>/);
});

test("grouped bars scale all three events and keep raw counts", () => {
  const day = {
    date: "2024-01-01",
    receivedOrders: "9".repeat(90),
    deliveredOrders: "3",
    notCollectedOrders: "1",
  };
  const before = JSON.stringify(day);
  const geometry = p.chartGeometry([day], 392);
  assert.ok(geometry.max > BigInt(day.receivedOrders));
  assert.ok(geometry.y(day.receivedOrders) >= 40);
  const html = render("OrdersTrend", { trend: [day] });
  assert.equal(JSON.stringify(day), before);
  assert.equal((html.match(/data-series=/g) ?? []).length, 3);
  assert.match(html, /data-series="receivedOrders"/);
  assert.match(html, /data-series="deliveredOrders".*?data-count="3"/);
  assert.match(html, /data-series="notCollectedOrders".*?data-count="1"/);
  assert.match(html, /<pattern/);
  assert.ok(html.includes(p.formatCount(day.receivedOrders)));
});

test("a 366-day bar chart preserves every date and series without aggregation", () => {
  const trend = Array.from({ length: 366 }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
    receivedOrders: "6",
    deliveredOrders: "3",
    notCollectedOrders: "1",
  }));
  const html = render("OrdersTrend", { trend });
  assert.equal((html.match(/data-series=/g) ?? []).length, 1098);
  assert.match(html, /data-date="2024-12-31"/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
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
  assert.match(empty, /Sin productos entregados verificables/);
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
    "100 %",
    "Fuera del Top 10",
    "$123",
    "no se suman",
    "subtotales históricos",
  ])
    assert.ok(html.includes(text), text);
});
test("coverage explains pending checks and real issues without an audit table or backend codes", () => {
  const html = render("DashboardCoverage", {
    coverage: adminDashboardFixture({ unavailable: true }).coverage,
  });
  for (const text of [
    "Información sobre los datos",
    "¿Por qué?",
    "No se ha comprobado todo el histórico",
    "pedidos de prueba",
    "falta el detalle de productos",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /NOT_CHECKED|UNKNOWN|CREATED_COHORT|RECORDED_TERMINAL_EVENTS|UNVERIFIED_ORDER_PROVENANCE|SELECTED_EVENT_ORDERS|SQL|PRIVATE|<table/,
  );
});
test("pending history never claims missing orders or invalid dates; detected anomalies stay expanded", () => {
  const coverage = adminDashboardFixture().coverage;
  const normal = render("DashboardCoverage", { coverage });
  assert.doesNotMatch(
    normal,
    /podrían no incluir|fecha de cierre no válida|<details open/,
  );
  assert.equal(
    (normal.match(/No se ha comprobado todo el histórico/g) ?? []).length,
    1,
  );
  coverage.checks[0].status = "WARN";
  coverage.checks[0].affectedOrders = "1";
  const invalid = render("DashboardCoverage", { coverage });
  assert.match(invalid, /podrían no incluir todos los pedidos/);
  assert.match(invalid, /<details open/);
  assert.match(invalid, /fecha de cierre no válida/);
});
test("five KPIs and one secondary amount preserve null rate and place uncollected money only in its section", () => {
  const data = adminDashboardFixture({ empty: true });
  const summary = render("DashboardSummary", { summary: data.summary });
  assert.match(summary, /Sin base de cálculo/);
  assert.doesNotMatch(summary, /0 %/);
  assert.equal((summary.match(/<dd\b/g) ?? []).length, 6);
  const section = render("NotCollectedProducts", {
    ranking: data.notCollectedProducts,
    summary: data.summary,
  });
  assert.match(section, /Productos distintos afectados/);
  assert.match(section, /Valor asociado a pedidos no recogidos/);
  assert.doesNotMatch(
    section,
    /<dt>Pedidos no recogidos|<dt>Unidades no recogidas|Universo completo/,
  );
  assert.match(section, /Total del período/);
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
  assert.match(html, /Consultando el período seleccionado/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /skeletonChart/);
  assert.match(html, /skeletonRows/);
  assert.equal((html.match(/class="skeletonMetric"/g) ?? []).length, 5);
  const placeholder = render("DashboardLoading", {});
  assert.doesNotMatch(placeholder.replace(/<[^>]*>/g, ""), /[0-9$%]/);
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
    assert.doesNotMatch(html, /skeletonChart/);
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
    "Período consultado",
    "Colombia",
    "Importes en COP",
    "Productos no recogidos",
    "Productos más entregados",
    "No hay pedidos finalizados con fecha en este período.",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Próximamente|PRIVATE/);
});

test("compact dates use the server period across month and year boundaries", () => {
  const base = adminDashboardFixture().period;
  for (const [from, to, range, expected] of [
    ["2026-10-25", "2026-10-25", "TODAY", "25 oct 2026"],
    ["2026-10-19", "2026-10-25", "LAST_7_DAYS", "19–25 oct 2026"],
    ["2026-09-26", "2026-10-25", "LAST_30_DAYS", "26 sep – 25 oct 2026"],
    ["2025-12-28", "2026-01-03", "CUSTOM", "28 dic 2025 – 3 ene 2026"],
  ])
    assert.equal(p.compactPeriodLabel({ ...base, range, from, to }), expected);
});
