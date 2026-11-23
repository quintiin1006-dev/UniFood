import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const contracts = loadTs("features/client-orders/contracts.ts");
const presentation = loadTs("features/client-orders/presentation.ts");
const errors = loadTs("features/client-orders/errors.ts");
const messages = loadTs("features/shared/messages.ts");

const ID = "00000000-0000-0000-0000-000000000051";
const raw = (extra = {}) => ({
  id: ID,
  status: "PENDING",
  total: "9000.00",
  note: "Sin cebolla",
  createdAt: "2026-11-20T17:00:00Z",
  items: [
    {
      name: "Jugo natural",
      quantity: 2,
      unitPrice: "4500.00",
      subtotal: "9000.00",
    },
  ],
  cafeteria: { id: "00000000-0000-0000-0000-000000000031", name: "Central" },
  cancellationSource: null,
  rejectionReason: null,
  reminderCount: 0,
  requestedPickupAt: "2026-11-20T18:30:00Z",
  ...extra,
});

test("the order of Spring is read without guessing", () => {
  const order = contracts.toClientOrder(raw());
  assert.equal(order.status, "PENDING");
  assert.equal(order.note, "Sin cebolla");
  assert.equal(order.requestedPickupAt, "2026-11-20T18:30:00Z");
  assert.equal(order.items[0].quantity, 2);
  assert.equal(contracts.toClientOrder(raw({ note: null })).note, null);
  assert.equal(
    contracts.toClientOrder(raw({ requestedPickupAt: undefined }))
      .requestedPickupAt,
    null,
  );
  for (const bad of [
    null,
    [],
    raw({ status: "SHIPPED" }),
    raw({ id: "not-a-uuid" }),
    raw({ total: "9000,00" }),
    raw({ items: [{ name: "x", quantity: 0, unitPrice: "1", subtotal: "1" }] }),
    raw({ cafeteria: null }),
  ])
    assert.equal(contracts.toClientOrder(bad), null);
});

test("history pages need orders and a cursor or null", () => {
  const item = {
    id: ID,
    status: "DELIVERED",
    total: "9000.00",
    createdAt: "2026-11-20T17:00:00Z",
    cafeteriaName: "Central",
    itemCount: 3,
    summary: "3× Arepa de queso",
  };
  assert.deepEqual(
    contracts.toHistoryPage({ orders: [item], nextCursor: "abc_-1" }),
    { orders: [{ ...item, serviceFee: 0 }], nextCursor: "abc_-1" },
  );
  assert.equal(
    contracts.toHistoryPage({ orders: [], nextCursor: null }).nextCursor,
    null,
  );
  assert.equal(contracts.toHistoryPage({ orders: [item] }), null);
  assert.equal(
    contracts.toHistoryPage({
      orders: [{ ...item, status: "?" }],
      nextCursor: null,
    }),
    null,
  );
});

test("every state has a headline; rejected, cancelled and closed read differently", () => {
  const line = (extra) =>
    presentation.statusLine(contracts.toClientOrder(raw(extra)));
  for (const status of [
    "PENDING",
    "PREPARING",
    "READY",
    "CALLED",
    "DELIVERED",
    "NOT_COLLECTED",
    "CANCELLED",
  ]) {
    const { title, detail } = line({ status });
    assert.ok(title && detail, status);
  }
  assert.match(line({ status: "READY" }).detail, /efectivo en caja/);
  assert.equal(
    line({
      status: "CANCELLED",
      cancellationSource: "WORKER",
      rejectionReason: "Sin stock",
    }).detail,
    "Motivo: Sin stock",
  );
  assert.match(
    line({ status: "CANCELLED", cancellationSource: "CLIENT" }).title,
    /Cancelaste/,
  );
  assert.match(
    line({ status: "CANCELLED", cancellationSource: "SYSTEM" }).title,
    /cerrado/,
  );
  assert.match(
    line({ status: "CALLED", reminderCount: 2 }).detail,
    /Recordatorio 2/,
  );
});

test("steps follow the active states only", () => {
  assert.equal(presentation.stepOf("PENDING"), "sent");
  assert.equal(presentation.stepOf("PREPARING"), "preparing");
  assert.equal(presentation.stepOf("READY"), "ready");
  assert.equal(presentation.stepOf("CALLED"), "ready");
  for (const over of ["DELIVERED", "CANCELLED", "NOT_COLLECTED"])
    assert.equal(presentation.stepOf(over), null);
});

test("the pickup time is shown in Bogotá time", () => {
  const order = contracts.toClientOrder(raw());
  assert.equal(presentation.pickupLabel(order), "Recoger a las 13:30");
  assert.equal(
    presentation.pickupLabel(
      contracts.toClientOrder(raw({ requestedPickupAt: null })),
    ),
    null,
  );
});

test("failures use the central catalogue and tell connection from empty", () => {
  assert.equal(errors.connectionFailure().connection, true);
  assert.equal(errors.connectionFailure().message, messages.CONNECTION_FAILED);
  assert.equal(errors.orderFailure(502).connection, true);
  assert.equal(errors.orderFailure(401).login, true);
  assert.equal(
    errors.orderFailure(404, "ORDER_NOT_FOUND").message,
    messages.BACKEND_ERROR_MESSAGES.ORDER_NOT_FOUND,
  );
  // «Ya no se puede cancelar» is the client's wording of ORDER_ALREADY_PREPARING.
  assert.equal(
    errors.cancelFailure(409, "ORDER_ALREADY_PREPARING").message,
    messages.CLIENT_ORDER_NOT_CANCELLABLE,
  );
  assert.equal(
    errors.cancelFailure(409, "INVALID_ORDER_STATE").message,
    messages.CLIENT_ORDER_CHANGED,
  );
  // The client never reads the worker's «revisa el tablero».
  assert.doesNotMatch(
    errors.cancelFailure(409, "ORDER_CONCURRENT_MODIFICATION").message,
    /tablero/,
  );
  assert.equal(errors.cancelFailure(502).connection, true);
});
