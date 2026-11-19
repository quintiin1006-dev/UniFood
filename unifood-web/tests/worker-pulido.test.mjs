import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/cliente-pulido · worker: detalle sin repeticiones, historial compacto y nav único.

const order = (items, overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000091",
  student: "Laura Gómez",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: new Date(Date.now() - 36 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  items,
  status: "pending",
  ...overrides,
});
const item = (quantity, unitPrice = 7000, name = "Almuerzo") => ({
  name,
  quantity,
  unitPrice,
  subtotal: quantity * unitPrice,
});
const detail = (props) => {
  const { default: OrderDetail } = availabilityLoader()(
    "components/worker/OrderDetail.tsx",
  );
  return renderToStaticMarkup(
    React.createElement(OrderDetail, { onClose() {}, onAction() {}, ...props }),
  );
};

test("one product, one unit: the line is the total; no «c/u» and no Total row", () => {
  const html = detail({ order: order([item(1)]) });
  assert.match(html, /1 × Almuerzo/);
  assert.doesNotMatch(html, /c\/u/);
  assert.doesNotMatch(html, /<span>Total<\/span>/);
  assert.equal((html.match(/7\.000/g) || []).length, 1);
});

test("more than one unit or product: «c/u» and the Total row appear", () => {
  const two = detail({ order: order([item(2)]) });
  assert.match(two, /c\/u/);
  assert.match(two, /<span>Total<\/span>/);
  const mixed = detail({ order: order([item(1), item(1, 3000, "Jugo")]) });
  assert.doesNotMatch(mixed, /c\/u/);
  assert.match(mixed, /<span>Total<\/span>/);
});

test("the age of the order appears once, beside the name; «Tiempo de pedido» is gone", () => {
  const html = detail({ order: order([item(1)]) });
  assert.doesNotMatch(html, /Tiempo de pedido/);
  assert.equal((html.match(/Hace \d+ min/g) || []).length, 1);
  assert.ok(html.indexOf("Laura Gómez") < html.indexOf("Hace "));
});

test("hierarchy: name, products, action, then a separate «Rechazar» outline", () => {
  const html = detail({ order: order([item(1)]), onReject() {} });
  const name = html.indexOf("Laura Gómez");
  const product = html.indexOf("1 × Almuerzo");
  const action = html.indexOf("Pasar a preparación");
  const reject = html.indexOf(">Rechazar<");
  assert.ok(name < product && product < action && action < reject);
  // No «Rechazar» without the handler, and never once the order is ready.
  assert.doesNotMatch(detail({ order: order([item(1)]) }), />Rechazar</);
  assert.doesNotMatch(
    detail({ order: order([item(1)], { status: "ready" }), onReject() {} }),
    />Rechazar</,
  );
});

test("the history range carries full dates and the rows are grouped by Bogotá day", () => {
  const presentation = availabilityLoader()(
    "features/worker-history/presentation.ts",
  );
  assert.equal(
    presentation.formatShortRange("2026-11-01", "2026-11-18"),
    "01/11/2026 – 18/11/2026",
  );
  assert.equal(
    presentation.formatShortRange("2025-12-28", "2026-01-03"),
    "28/12/2025 – 03/01/2026",
  );
  assert.equal(presentation.formatDayDate("2026-11-19"), "19/11/2026");
  const groups = presentation.groupHistoryByDay([
    { completedAt: "2026-11-18T15:00:00Z" },
    { completedAt: "2026-11-18T13:00:00Z" },
    // 23:30 of the 17th in Bogotá, although it is already the 18th in UTC.
    { completedAt: "2026-11-18T04:30:00Z" },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.key, group.orders.length]),
    [
      ["2026-11-18", 2],
      ["2026-11-17", 1],
    ],
  );
});

test("one worker nav for every module, sized the same at any page scale", () => {
  const nav = fs.readFileSync("components/worker/BottomNav.tsx", "utf8");
  assert.match(nav, /const styles = classicStyles;/);
  const css = fs.readFileSync(
    "components/worker/BottomNav.classic.module.css",
    "utf8",
  );
  assert.match(css, /calc\(553px \/ var\(--worker-zoom, 1\)\)/);
  assert.doesNotMatch(css, /width: min\(790px/);
});
