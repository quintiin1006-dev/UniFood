import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const load = () => availabilityLoader();

const order = (overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000071",
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

// ---------------------------------------------------------------- label

test("the pickup label is HH:mm in Bogotá, whatever offset the instant carries", () => {
  const { pickupLabel } = load()("features/orders/utils/pickupTime.ts");
  assert.equal(pickupLabel("2026-11-20T18:30:00Z"), "Recoger a las 13:30");
  assert.equal(pickupLabel("2026-11-20T13:05:00-05:00"), "Recoger a las 13:05");
  // 24-hour clock, and the UTC date does not leak into Bogotá's evening.
  assert.equal(pickupLabel("2026-11-21T04:45:00Z"), "Recoger a las 23:45");
  assert.equal(pickupLabel("2026-11-20T12:00:00Z"), "Recoger a las 07:00");
});

test("without a pickup time, or with an unreadable one, there is no label", () => {
  const { pickupLabel } = load()("features/orders/utils/pickupTime.ts");
  for (const value of [undefined, null, "", "pronto"])
    assert.equal(pickupLabel(value), null, String(value));
});

test("the mapper keeps the pickup time and turns null into absent", () => {
  const { mapBackendOrder } = load()("features/orders/utils/orderMapper.ts");
  const backend = {
    id: "o1",
    cafeteriaId: "c1",
    clientId: null,
    clientName: "Ana Torres",
    clientCode: null,
    clientType: "STAFF",
    status: "PENDING",
    total: 13000,
    createdAt: "2026-11-20T16:00:00Z",
    updatedAt: "2026-11-20T16:00:00Z",
    items: [],
  };
  assert.equal(
    mapBackendOrder({ ...backend, requestedPickupAt: "2026-11-20T18:30:00Z" })
      .requestedPickupAt,
    "2026-11-20T18:30:00Z",
  );
  assert.equal(
    mapBackendOrder({ ...backend, requestedPickupAt: null }).requestedPickupAt,
    undefined,
  );
  assert.equal(mapBackendOrder(backend).requestedPickupAt, undefined);
});

// ---------------------------------------------------------------- card

test("the card shows «Recoger a las HH:mm» when the order has a pickup time", () => {
  for (const status of ["pending", "preparing", "ready", "called"]) {
    const html = card({
      order: order({ status, requestedPickupAt: "2026-11-20T18:30:00Z" }),
    });
    assert.match(html, /Recoger a las 13:30/, status);
  }
});

test("the card without a pickup time shows nothing about it", () => {
  for (const requestedPickupAt of [undefined, null]) {
    const html = card({ order: order({ requestedPickupAt }) });
    assert.doesNotMatch(html, /Recoger/);
    assert.doesNotMatch(html, /pickupTime/);
  }
  // The rest of the card is unchanged.
  assert.match(card({ order: order() }), /Ana Torres/);
});
