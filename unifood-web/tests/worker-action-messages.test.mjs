import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// docs/ui-paneles.md, PR 2 of the worker: fixed messages by code (W4) and a non-blocking
// action alert (W3).

const load = () => availabilityLoader();
const messages = () => load()("features/orders/orderActionMessages.ts");

test("board transitions get a fixed message for every code and status", () => {
  const { orderActionMessage, ORDER_STATE_CHANGED, ORDER_SEQUENCE_MESSAGE } =
    messages();
  assert.equal(
    orderActionMessage(409, "ORDER_PROCESSING_SEQUENCE_VIOLATION"),
    ORDER_SEQUENCE_MESSAGE,
  );
  for (const code of [
    "INVALID_ORDER_STATE",
    "ORDER_CONCURRENT_MODIFICATION",
    null,
  ])
    assert.equal(orderActionMessage(409, code), ORDER_STATE_CHANGED);
  assert.equal(orderActionMessage(404, null), ORDER_STATE_CHANGED);
  assert.equal(
    orderActionMessage(409, "ORDER_CANCELLED_BY_CLIENT"),
    "El cliente canceló este pedido.",
  );
  assert.match(orderActionMessage(401, null), /Inicia sesión/);
  assert.match(orderActionMessage(403, "FORBIDDEN"), /permisos/);
  for (const status of [0, 502, 503])
    assert.match(orderActionMessage(status, null), /Revisa la conexión/);
  assert.match(orderActionMessage(400, null), /Inténtalo de nuevo/);
});

test("rejections get fixed messages and never Spring's text", () => {
  const { rejectionMessage } = messages();
  assert.match(
    rejectionMessage(400, "REJECTION_REASON_REQUIRED"),
    /al menos 3/,
  );
  assert.match(rejectionMessage(400, "REJECTION_REASON_TOO_LONG"), /200/);
  assert.match(
    rejectionMessage(409, "INVALID_ORDER_STATE"),
    /ya no se puede rechazar/,
  );
  assert.match(rejectionMessage(0, null), /Revisa la conexión/);
});

test("advance and reject turn network failures and JSON errors into fixed messages", async () => {
  let respond;
  const api = availabilityLoader({ fetchMock: (...args) => respond(...args) })(
    "features/orders/api/orderApi.ts",
  );
  const order = { id: "o1", status: "pending", student: "Ana", items: [] };
  try {
    respond = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(api.advanceOrder(order), (error) => {
      assert.equal(error.status, 0);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    });
    respond = async () =>
      Response.json(
        { code: "INVALID_ORDER_STATE", message: "PRIVATE Spring text" },
        { status: 409 },
      );
    await assert.rejects(api.rejectOrder(order, "Se acabó"), (error) => {
      assert.equal(error.code, "INVALID_ORDER_STATE");
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    });
  } finally {
    respond = undefined;
  }
});

test("the action alert is a non-modal strip with a close button", () => {
  const { OrderActionAlert } = load()(
    "features/orders/components/OrderActionAlert.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(OrderActionAlert, {
      title: "Acción no disponible",
      message: "Primero pasa a preparación el pedido más antiguo de hoy.",
      onClose() {},
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-label="Cerrar aviso"/);
  assert.doesNotMatch(html, /aria-modal|role="dialog"|Entendido/);
});
