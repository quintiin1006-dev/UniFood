import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// docs/ui-paneles.md, PR 3 of the worker: W7, D1, D2, D3, D5 and L3.

const load = () => availabilityLoader();
const order = (overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000091",
  student: "Laura Gómez",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
  status: "pending",
  ...overrides,
});
const render = (file, props, name) => {
  const mod = load()(file);
  return renderToStaticMarkup(
    React.createElement(name ? mod[name] : mod.default, props),
  );
};

test("a called order says «Cliente avisado», also for staff (W7)", () => {
  const html = render("components/worker/OrderCard.tsx", {
    order: order({ status: "called", clientType: "STAFF", clientCode: null }),
    onOpen() {},
    onAction() {},
  });
  assert.match(html, /Cliente avisado/);
  assert.doesNotMatch(html, /Estudiante avisado/);
});

test("the delivery time is Bogotá's, in 24 h, whatever the browser zone (D3)", () => {
  const { formatClockTime } = load()("lib/orderTime.ts");
  // 02:38 UTC is 21:38 of the previous day in Bogotá.
  assert.equal(formatClockTime("2026-11-21T02:38:00Z"), "21:38");
});

test("the board detail shows the pickup time and keeps the note's line breaks (D1, D2)", () => {
  const html = render("components/worker/OrderDetail.tsx", {
    order: order({
      note: "Sin cebolla.\nRecojo con mi compañera.",
      requestedPickupAt: "2026-11-20T17:30:00Z",
    }),
    onClose() {},
    onAction() {},
  });
  assert.match(html, /Hora de recogida/);
  assert.match(html, /Recoger a las 12:30/);
  assert.match(html, /Observaciones/);
  assert.match(html, /Sin cebolla\.\nRecojo con mi compañera\./);
});

test("the calls detail uses «Observaciones» and shows the pickup time (D1, D2)", () => {
  const selected = order({
    status: "called",
    note: "Sin cebolla",
    requestedPickupAt: "2026-11-20T17:30:00Z",
    calledAt: "2026-11-20T16:30:00Z",
  });
  const html = render("components/worker/CallsBoard.tsx", {
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
  assert.match(html, /<strong>Observaciones<\/strong>/);
  assert.doesNotMatch(html, /Nota del pedido/);
  assert.match(html, /Recoger a las 12:30/);
});

test("a blocked reminder explains itself without visible text: a spinning wait and a tooltip (D5)", () => {
  const file = "features/orders/components/CalledOrderActions.tsx";
  const called = order({
    status: "called",
    calledAt: "2026-11-20T16:30:00Z",
    reminderCount: 1,
    maxReminders: 5,
    lastRemindedAt: "2026-11-20T16:30:00Z",
  });
  const waiting = render(
    file,
    { order: called, now: Date.parse("2026-11-20T16:32:00Z"), onRemind() {} },
    "RemindButton",
  );
  assert.match(waiting, /Podrás volver a recordar en 3 min/);
  assert.match(waiting, /lucide-refresh-cw/);
  assert.doesNotMatch(waiting, /En \d+ min|0\/3|1\/3/);
  const ready = render(
    file,
    { order: called, now: Date.parse("2026-11-20T16:40:00Z"), onRemind() {} },
    "RemindButton",
  );
  assert.match(ready, /lucide-bell/);
});

test("D4: the calls detail reads at a glance: name and time on top, products, total and notes apart", () => {
  const selected = order({
    status: "called",
    calledAt: "2026-11-20T16:30:00Z",
    note: "Sin cebolla",
    total: 26000,
    items: [
      { id: "a", name: "Almuerzo del día", quantity: 2, subtotal: 26000 },
    ],
  });
  const html = render("components/worker/CallsBoard.tsx", {
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
  const detail = html.slice(html.indexOf('aria-label="Detalle del pedido"'));
  assert.match(detail, /<h2>Laura Gómez<\/h2>/);
  assert.match(detail, /Llamado a las/);
  assert.ok(detail.indexOf("Laura Gómez") < detail.indexOf("Almuerzo del día"));
  assert.match(detail, /<ul class="products">/);
  assert.match(detail, />2<span aria-hidden="true">×<\/span>/);
  assert.ok(detail.indexOf("Almuerzo del día") < detail.indexOf(">Total"));
  assert.ok(detail.indexOf(">Total") < detail.indexOf("Observaciones"));
  // Less text: none of the old labels.
  assert.doesNotMatch(
    detail,
    /RESUMEN PARA ENTREGA|ENTREGAR A|Lo que pidió|por unidad|Pesos colombianos|Avisos enviados|cant\./,
  );
});

test("the rejection dialog has a visible close button besides «Volver» (D5)", () => {
  const html = render(
    "features/orders/components/RejectOrderDialog.tsx",
    {
      order: order(),
      onClose() {},
      onConfirm: async () => ({ error: "x" }),
    },
    "RejectOrderDialog",
  );
  assert.match(html, /aria-label="Cerrar sin rechazar"/);
  assert.match(html, />Volver</);
});
