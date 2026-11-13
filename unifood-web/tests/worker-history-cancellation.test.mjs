import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerHistoryFixture } from "./helpers/worker-history-fixture.mjs";

const load = availabilityLoader();
const { historyStatusText } = load("features/worker-history/presentation.ts");
const { parseWorkerHistory } = load("features/worker-history/contracts.ts");

const cancelled = (cancellationSource, rejectionReason = null) => ({
  status: "CANCELLED",
  cancellationSource,
  rejectionReason,
});

// ---------------------------------------------------------------- texts

test("each way an order ended has its own fixed Spanish text", () => {
  assert.equal(
    historyStatusText(cancelled("WORKER", "Se acabó el pollo")),
    "Rechazado por la cafetería: Se acabó el pollo",
  );
  assert.equal(
    historyStatusText(cancelled("CLIENT")),
    "Cancelado por el cliente",
  );
  assert.equal(
    historyStatusText(cancelled("SYSTEM")),
    "Cerrado por el sistema",
  );
  assert.equal(
    historyStatusText({ status: "NOT_COLLECTED", cancellationSource: null }),
    "No recogido",
  );
  assert.equal(
    historyStatusText({ status: "DELIVERED", cancellationSource: null }),
    "Entregado",
  );
});

test("older cancellations keep an honest text without inventing a reason", () => {
  // Before 021 there is no source; a worker cancellation before B18 has no reason.
  assert.equal(historyStatusText(cancelled(null)), "Cancelado");
  assert.equal(
    historyStatusText(cancelled("WORKER")),
    "Cancelado por la cafetería",
  );
});

// ---------------------------------------------------------------- contract

const page = (entry) => {
  const data = workerHistoryFixture();
  data.orders = [{ ...data.orders[2], ...entry }];
  return data;
};

test("the contract keeps the source and the reason of a worker rejection", () => {
  const parsed = parseWorkerHistory(
    page({ cancellationSource: "WORKER", rejectionReason: "  Sin gas  " }),
  );
  assert.equal(parsed.orders[0].cancellationSource, "WORKER");
  assert.equal(parsed.orders[0].rejectionReason, "Sin gas");
});

test("a reason is dropped unless the cafeteria rejected the order", () => {
  for (const source of ["CLIENT", "SYSTEM", null]) {
    const parsed = parseWorkerHistory(
      page({ cancellationSource: source, rejectionReason: "PRIVATE_REASON" }),
    );
    assert.equal(parsed.orders[0].cancellationSource, source);
    assert.equal(parsed.orders[0].rejectionReason, null);
  }
  const delivered = parseWorkerHistory(
    page({
      status: "DELIVERED",
      cancellationSource: "WORKER",
      rejectionReason: "PRIVATE_REASON",
    }),
  );
  assert.equal(delivered.orders[0].cancellationSource, null);
  assert.equal(delivered.orders[0].rejectionReason, null);
});

test("older responses without the fields are still accepted", () => {
  const data = page({});
  delete data.orders[0].cancellationSource;
  delete data.orders[0].rejectionReason;
  const parsed = parseWorkerHistory(data);
  assert.equal(parsed.orders[0].cancellationSource, null);
  assert.equal(parsed.orders[0].rejectionReason, null);
});

test("an unknown source or an oversized reason rejects the whole page", () => {
  assert.equal(parseWorkerHistory(page({ cancellationSource: "ADMIN" })), null);
  assert.equal(
    parseWorkerHistory(
      page({ cancellationSource: "WORKER", rejectionReason: "x".repeat(301) }),
    ),
    null,
  );
  assert.equal(
    parseWorkerHistory(
      page({ cancellationSource: "WORKER", rejectionReason: 7 }),
    ),
    null,
  );
});

// ---------------------------------------------------------------- card

function card(entry) {
  const { HistoryOrderCard } = load(
    "features/worker-history/components/HistoryOrderCard.tsx",
  );
  const order = parseWorkerHistory(page(entry)).orders[0];
  return renderToStaticMarkup(React.createElement(HistoryOrderCard, { order }));
}

test("the card shows the rejection reason as plain text, never HTML", () => {
  const html = card({
    cancellationSource: "WORKER",
    rejectionReason: '<img src=x onerror="alert(1)"> & ñ',
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(
    html,
    /Rechazado por la cafetería: &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; ñ/,
  );
});

test("the card distinguishes the client, the system and not collected", () => {
  assert.match(
    card({ cancellationSource: "CLIENT" }),
    /Cancelado por el cliente/,
  );
  assert.match(
    card({ cancellationSource: "SYSTEM" }),
    /Cerrado por el sistema/,
  );
  assert.match(
    card({ status: "NOT_COLLECTED", cancellationSource: null }),
    /No recogido/,
  );
});
