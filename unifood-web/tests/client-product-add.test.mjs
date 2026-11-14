import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 2 · D5: the «+» on a product card reuses the cart and explains why it is off.

const menu = (open, available) => ({
  cafeteria: { id: "c1", name: "Central", open },
  businessDate: "2026-11-20",
  categories: [],
});
const product = (available = true) => ({
  id: "p1",
  name: "Arepa de queso",
  description: null,
  price: 4500,
  imageUrl: null,
  available,
});

function render(cart, { open = true, available = true } = {}) {
  const load = availabilityLoader({
    mocks: {
      "./ClientCartProvider": {
        useClientCart: () => ({ cart, add() {}, update() {} }),
      },
    },
  });
  const { default: ProductAddButton } = load(
    "features/client/components/ProductAddButton.tsx",
  );
  return renderToStaticMarkup(
    React.createElement(ProductAddButton, {
      menu: menu(open),
      product: product(available),
    }),
  );
}

test("a sold-out product or a closed cafeteria disables the button and says why", () => {
  const empty = { cafeteriaId: null, lines: [] };
  const soldOut = render(empty, { available: false });
  assert.match(soldOut, />Agotado</);
  assert.doesNotMatch(soldOut, /<button/);
  const closed = render(empty, { open: false });
  assert.match(closed, />Cerrada</);
  assert.doesNotMatch(closed, /<button/);
});

test("an available product offers a labelled add button, and a stepper once it is in the cart", () => {
  const add = render({ cafeteriaId: null, lines: [] });
  assert.match(add, /aria-label="Agregar Arepa de queso al carrito"/);
  const inCart = render({
    cafeteriaId: "c1",
    lines: [{ productId: "p1", quantity: 2 }],
  });
  assert.match(inCart, /role="group" aria-label="Cantidad de Arepa de queso"/);
  assert.match(inCart, /aria-label="Quitar una unidad de Arepa de queso"/);
  assert.match(inCart, /aria-label="Agregar otra unidad de Arepa de queso"/);
  assert.match(inCart, />2</);
});

test("the card link and the add button are siblings, so the button never opens the product", () => {
  const home = fs.readFileSync(
    "features/client/components/ClientHome.tsx",
    "utf8",
  );
  assert.match(home, /<\/Link>\s*\{\/\* Sibling of the link/);
});
