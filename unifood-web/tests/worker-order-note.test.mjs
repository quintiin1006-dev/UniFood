import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const load = () => availabilityLoader();

const backend = {
  id: "o1",
  cafeteriaId: "c1",
  clientId: null,
  clientName: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  status: "PENDING",
  total: 13000,
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
};

const order = (overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000081",
  student: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
  status: "pending",
  ...overrides,
});

function card(props) {
  const { default: OrderCard } = load()("components/worker/OrderCard.tsx");
  return renderToStaticMarkup(
    React.createElement(OrderCard, {
      onOpen() {},
      onAction() {},
      ...props,
    }),
  );
}

// ---------------------------------------------------------------- mapper

test("the mapper keeps the note verbatim and turns null or absent into undefined", () => {
  const { mapBackendOrder } = load()("features/orders/utils/orderMapper.ts");
  const text = 'Sin cebolla\n<b>ají</b> & "aparte"';
  assert.equal(mapBackendOrder({ ...backend, note: text }).note, text);
  assert.equal(mapBackendOrder({ ...backend, note: null }).note, undefined);
  assert.equal(mapBackendOrder(backend).note, undefined);
});

// ---------------------------------------------------------------- card

test("the card shows the note under the fixed label «Observaciones»", () => {
  const html = card({ order: order({ note: "Sin cebolla, por favor" }) });
  assert.match(html, /<strong>Observaciones<\/strong>/);
  assert.match(html, /<p>Sin cebolla, por favor<\/p>/);
});

test("without a note, or with only spaces, the card shows no observations block", () => {
  for (const note of [undefined, null, "", "   "]) {
    const html = card({ order: order({ note }) });
    assert.doesNotMatch(html, /Observaciones/, String(note));
  }
});

test("markup in the note is shown as plain text, never as HTML", () => {
  const html = card({
    order: order({
      note: '<img src=x onerror="alert(1)"><script>alert(2)</script> & ñ 🌶',
    }),
  });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt; &amp; ñ 🌶/);
});

test("a long note with line breaks is kept whole, without cutting", () => {
  const note =
    "Primera línea con indicaciones\nSegunda línea: " +
    "sin-espacios-".repeat(14) +
    "fin";
  const html = card({ order: order({ note }) });
  assert.ok(html.includes(note), "the whole note is rendered");
});

test("the note and «Recoger a las HH:mm» can appear together", () => {
  const html = card({
    order: order({
      note: "Sin cebolla",
      requestedPickupAt: "2026-11-20T18:30:00Z",
    }),
  });
  assert.match(html, /Recoger a las 13:30/);
  assert.match(html, /Observaciones/);
  assert.ok(
    html.indexOf("Recoger a las") < html.indexOf("Observaciones"),
    "pickup first, then the note",
  );
});

test("the note style keeps line breaks and wraps long words", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(
    "features/orders/components/OrderNote.module.css",
    "utf8",
  );
  assert.match(css, /white-space:\s*pre-wrap/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});
