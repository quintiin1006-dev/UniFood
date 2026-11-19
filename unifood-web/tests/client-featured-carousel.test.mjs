import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Portada del inicio del cliente: avanza sola cada 5 s, no se detiene, y con movimiento reducido
// se queda en el primer producto.

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

test("the carousel moves every 5 seconds with two or more products, unless reduced motion", () => {
  const { canRotate, ROTATE_MS } = domain();
  assert.equal(ROTATE_MS, 5000);
  assert.equal(canRotate({ count: 1, reducedMotion: false }), false);
  assert.equal(canRotate({ count: 0, reducedMotion: false }), false);
  assert.equal(canRotate({ count: 3, reducedMotion: true }), false);
  assert.equal(canRotate({ count: 3, reducedMotion: false }), true);
});

test("with reduced motion only the first product stays on screen; otherwise all of them", () => {
  const { carouselSlides } = domain();
  const list = [product("a"), product("b"), product("c")];
  assert.deepEqual(
    carouselSlides(list, true).map((p) => p.id),
    ["a"],
  );
  assert.deepEqual(
    carouselSlides(list, false).map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(carouselSlides([], true), []);
});

test("hover, focus or a finger pauses it (WCAG 2.2.2); nothing else does", () => {
  const { isPaused, canRotate } = domain();
  const none = { hover: false, focus: false, touch: false };
  assert.equal(isPaused(none), false);
  for (const key of ["hover", "focus", "touch"])
    assert.equal(isPaused({ ...none, [key]: true }), true, key);
  assert.equal(
    canRotate({ count: 3, reducedMotion: false, paused: true }),
    false,
  );
});

test("the loop goes forward onto a copy of the first slide and never rewinds", () => {
  const { loopTrack, nextLoopPosition } = domain();
  const track = loopTrack(["a", "b", "c"]);
  assert.deepEqual(
    track.map(({ item }) => item),
    ["a", "b", "c", "a"],
  );
  assert.deepEqual(
    track.map(({ clone }) => clone),
    [false, false, false, true],
  );
  // From the last real slide the next step is the copy, never back to 0 with a rewind.
  assert.equal(nextLoopPosition(2, 3), 3);
  assert.equal(nextLoopPosition(3, 3), 3);
  assert.equal(nextLoopPosition(0, 3), 1);
  // One slide needs no copy and does not move.
  assert.deepEqual(loopTrack(["a"]).length, 1);
  assert.equal(nextLoopPosition(0, 1), 0);
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

test("one product is one card with no rotation", () => {
  const html = render([product("a", true, "Arepa")]);
  assert.match(html, /aria-roledescription="carrusel"/);
  assert.match(html, /Arepa/);
  assert.equal(
    (html.match(/aria-roledescription="diapositiva"/g) || []).length,
    1,
  );
});

test("several products render every slide, and only the current one is reachable", () => {
  const html = render([product("a"), product("b"), product("c")]);
  assert.equal(
    (html.match(/aria-roledescription="diapositiva"/g) || []).length,
    3,
  );
  // Only the current slide is reachable: the other two and the loop copy are inert.
  assert.equal((html.match(/inert=""/g) || []).length, 3);
  // The copy of the first slide is hidden from assistive technology.
  assert.equal((html.match(/aria-hidden="true" inert=""/g) || []).length, 1);
});

test("the carousel shows no arrows, dots or pause button", () => {
  const html = render([product("a"), product("b"), product("c")]);
  assert.doesNotMatch(html, /Pausar carrusel|Reanudar carrusel/);
  assert.doesNotMatch(html, /Producto anterior|Producto siguiente/);
  assert.doesNotMatch(html, /aria-label="Ver /);
  assert.doesNotMatch(html, /aria-current=/);
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
