import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 4 · portada del inicio del cliente: índice, pausa y movimiento reducido.

const domain = () => availabilityLoader()("features/client/domain/featured.ts");
const product = (id, available = true, name = `Producto ${id}`) => ({
  id,
  name,
  description: null,
  price: 5000,
  available,
  category: "CORRIENTE",
});
const menu = (categories) => ({
  cafeteria: { id: "c1", name: "Central", open: true },
  businessDate: "2026-11-17",
  categories,
});

test("featured products are available ones only, in menu order, each once", () => {
  const { featuredProducts } = domain();
  const list = featuredProducts(
    menu([
      {
        id: "CORRIENTE",
        products: [product("a"), product("b", false), product("c")],
      },
      { id: "BEBIDA", products: [product("c"), product("d")] },
    ]),
  );
  assert.deepEqual(
    list.map((p) => p.id),
    ["a", "c", "d"],
  );
});

test("the index wraps around in both directions and is safe with no slides", () => {
  const { nextIndex, prevIndex } = domain();
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(prevIndex(0, 3), 2);
  assert.equal(prevIndex(1, 3), 0);
  assert.equal(nextIndex(0, 0), 0);
  assert.equal(prevIndex(0, 0), 0);
});

test("rotation needs two slides, no reduced motion and no pause", () => {
  const { canRotate, ROTATE_MS } = domain();
  assert.equal(ROTATE_MS, 5000);
  assert.equal(
    canRotate({ count: 1, reducedMotion: false, paused: false }),
    false,
  );
  assert.equal(
    canRotate({ count: 3, reducedMotion: true, paused: false }),
    false,
  );
  assert.equal(
    canRotate({ count: 3, reducedMotion: false, paused: true }),
    false,
  );
  assert.equal(
    canRotate({ count: 3, reducedMotion: false, paused: false }),
    true,
  );
});

test("any of hover, focus, touch or the pause button pauses the carousel", () => {
  const { isPaused } = domain();
  const none = { hover: false, focus: false, touch: false, user: false };
  assert.equal(isPaused(none), false);
  for (const key of ["hover", "focus", "touch", "user"])
    assert.equal(isPaused({ ...none, [key]: true }), true, key);
});

function render(products) {
  const load = availabilityLoader();
  const { default: FeaturedCarousel } = load(
    "features/client/components/FeaturedCarousel.tsx",
  );
  return renderToStaticMarkup(
    React.createElement(FeaturedCarousel, { products, cafeteriaId: "c1" }),
  );
}

test("no available product means no section at all", () => {
  assert.equal(render([]), "");
});

test("one product is one card with no controls and no rotation", () => {
  const html = render([product("a", true, "Arepa")]);
  assert.match(html, /aria-roledescription="carrusel"/);
  assert.match(html, /Arepa/);
  assert.doesNotMatch(html, /Pausar carrusel/);
  assert.doesNotMatch(html, /Producto siguiente/);
});

test("several products get arrows, dots and a pause button, and the rest of the slides are inert", () => {
  const html = render([product("a"), product("b"), product("c")]);
  assert.match(html, /aria-label="Producto anterior"/);
  assert.match(html, /aria-label="Producto siguiente"/);
  assert.match(html, /aria-label="Ver Producto b"/);
  assert.match(html, /Pausar carrusel/);
  assert.match(html, /aria-current="true"/);
  // Only the current slide is reachable: the other two are inert.
  assert.equal((html.match(/inert=""/g) || []).length, 2);
});

test("auto changes are not announced and the slide is labelled with its position", () => {
  const html = render([product("a"), product("b")]);
  assert.match(html, /aria-live="off"/);
  assert.match(html, /aria-label="1 de 2: Producto a"/);
  assert.match(html, /aria-roledescription="diapositiva"/);
});

test("the carousel itself never calls the backend", () => {
  const src = fs.readFileSync(
    "features/client/components/FeaturedCarousel.tsx",
    "utf8",
  );
  assert.doesNotMatch(src, /fetch\(|api\/|saveSubscription/);
});
