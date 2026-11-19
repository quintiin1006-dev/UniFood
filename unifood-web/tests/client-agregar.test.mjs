import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// jj/cliente-agregar: «+» compacto con anillo, aviso de máximo, aviso de cerrada y banner listo.

const read = (file) => fs.readFileSync(file, "utf8");
const messages = loadTs("features/shared/messages.ts");
const menu = {
  cafeteria: { id: "c1", name: "Central", open: true },
  businessDate: "2026-11-18",
  categories: [],
};
const product = {
  id: "p1",
  name: "Arepa",
  description: null,
  price: 5000,
  available: true,
  category: "CORRIENTE",
};
const addButton = (quantity, cafeteria = menu.cafeteria) => {
  const load = availabilityLoader({
    mocks: {
      "./ClientCartProvider": {
        useClientCart: () => ({
          cart: {
            cafeteriaId: "c1",
            lines: quantity ? [{ productId: "p1", quantity }] : [],
          },
          add: () => true,
          update: () => null,
        }),
      },
    },
  });
  const Button = load("features/client/components/ProductAddButton.tsx");
  return renderToStaticMarkup(
    React.createElement(Button.default, {
      menu: { ...menu, cafeteria },
      product,
    }),
  );
};

test("«+» is a 44 px target around a 36 px drawing, with its name and a live region", () => {
  const html = addButton(0);
  assert.match(html, /aria-label="Agregar Arepa al carrito"/);
  assert.match(html, /aria-live="polite"/);
  const css = read("features/client/components/ProductAddButton.module.css");
  assert.match(css, /\.target \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /\.face \{[^}]*width: 36px;[^}]*height: 36px;/);
  // «− n +» is never taller than 44 px.
  assert.match(css, /\.stepper \{[^}]*height: 44px;/);
  assert.equal(messages.addedLive(2), "Agregado, 2 en el carrito");
});

test("with units in the cart the compact «− n +» shows the count", () => {
  const html = addButton(2);
  assert.match(html, /aria-label="Cantidad de Arepa"/);
  assert.match(html, /Quitar una unidad de Arepa/);
  assert.match(html, /Agregar otra unidad de Arepa/);
  assert.match(html, />2</);
});

test("the ring is drawn clockwise in 600 ms; reduced motion keeps only a still check", () => {
  const css = read("features/client/components/ProductAddButton.module.css");
  assert.match(css, /animation: draw-ring 600ms/);
  assert.match(css, /stroke-dashoffset: 100;/);
  const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  assert.match(reduced, /\.ring \{\s*display: none;/);
  assert.match(reduced, /\.checkIcon \{\s*opacity: 1;\s*animation: none;/);
  const source = read("features/client/components/ProductAddButton.tsx");
  assert.match(source, /export const ADD_RING_MS = 600;/);
  // Taps during the ring keep adding: the «+» stays while ringing.
  assert.match(source, /ringing \|\| inCart === 0/);
});

test("a closed cafeteria keeps the «+» disabled with its reason", () => {
  const html = addButton(0, { ...menu.cafeteria, open: false });
  assert.match(html, />Cerrada</);
  assert.doesNotMatch(html, /<button/);
});

test("the limit is not fixed text: a 3 s notice after trying to pass it", () => {
  const hook = read("features/client/hooks/useLimitNotice.ts");
  assert.match(hook, /export const LIMIT_NOTICE_MS = 3000;/);
  const detail = read("features/client/components/ClientProduct.tsx");
  assert.doesNotMatch(detail, /Máximo \{MAX_PER_PRODUCT\} por producto y/);
  assert.doesNotMatch(detail, /CafeteriaSelector/);
  assert.match(detail, /limit\.show\(/);
  assert.match(detail, /role="status"/);
  // The «+» is not disabled silently at the limit.
  assert.doesNotMatch(detail, /quantity >= maximum \|\| !!blocker/);
  assert.equal(messages.LIMIT_PER_PRODUCT, "Máximo 10 por producto");
  const line = read("features/client/components/CartLineItem.tsx");
  assert.match(line, /limit\.show\(/);
  assert.doesNotMatch(line, /disabled=\{!canIncrease\}/);
});

const banner = (props = {}) => {
  const load = availabilityLoader();
  const Banner = load("features/client/components/ClosedBanner.tsx").default;
  return renderToStaticMarkup(React.createElement(Banner, props));
};

test("closed without an opening time: «Vuelve más tarde», nothing invented", () => {
  const html = banner();
  assert.match(html, /Cafetería cerrada/);
  assert.match(html, /Vuelve más tarde/);
  assert.doesNotMatch(html, /Abre a las/);
  assert.match(html, /role="status"/);
  assert.match(banner({ opensAt: "7:00 a. m." }), /Abre a las 7:00 a\. m\./);
});

test("the closed scene is inline SVG, translucent, slow and still with reduced motion", () => {
  const html = banner();
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /<img|\.gif/);
  const css = read("features/client/components/ClosedBanner.module.css");
  const opacity = Number(css.match(/\.scene \{[^}]*opacity: ([\d.]+);/)[1]);
  assert.ok(opacity <= 0.35);
  for (const seconds of [...css.matchAll(/animation: \w+ (\d+)s/g)].map((m) =>
    Number(m[1]),
  ))
    assert.ok(seconds >= 6 && seconds <= 12, String(seconds));
  const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  assert.match(reduced, /animation: none/);
});

test("Mi pedido ready banner: balanced title and a quieter name line", () => {
  const css = read("features/client-orders/components/ClientOrders.module.css");
  assert.match(css, /\.readyTitle \{[^}]*font-size: 23px;/);
  assert.match(
    css,
    /\.readyStudent \{[^}]*rgb\(255 255 255 \/ 90%\);[^}]*font-size: 16px;[^}]*font-weight: 600;/,
  );
  // The halo pulses twice on arrival, never forever, and not with reduced motion.
  assert.match(css, /animation: halo 1\.4s ease-out 2;/);
  assert.doesNotMatch(css, /\.readyCode strong/);
});
