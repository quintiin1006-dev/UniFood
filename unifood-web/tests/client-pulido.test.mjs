import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// jj/cliente-pulido: Inicio, nav, carrito en una pantalla, historial y contraseña olvidada.

const fixtures = loadTs("tests/fixtures/client-menu.ts");
const menuDomain = loadTs("features/client/domain/menu.ts");
const read = (file) => fs.readFileSync(file, "utf8");
const central = () =>
  menuDomain.toCafeteriaMenu(fixtures.clientMenus[fixtures.CAFETERIA_CENTRAL]);

const link = {
  __esModule: true,
  default: ({ href, children, ...rest }) =>
    React.createElement("a", { href, ...rest }, children),
};
const home = (menu) => {
  const load = availabilityLoader({
    mocks: {
      "../hooks/useCafeteriaMenu": {
        useCafeteriaMenu: () => ({
          state: { status: "ok", menu },
          stale: false,
          retry() {},
        }),
      },
      "./FeaturedCarousel": {
        __esModule: true,
        default: () => React.createElement("div", { "data-carousel": "" }),
      },
      "./CafeteriaMemory": { RememberCafeteria: () => null },
      "./ProductAddButton": { __esModule: true, default: () => null },
      "next/link": link,
    },
  });
  const Home = load("features/client/components/ClientHome.tsx").default;
  return renderToStaticMarkup(
    React.createElement(Home, {
      ownerId: "o",
      siteName: "Sede Principal",
      menu,
    }),
  );
};

test("Inicio: no greeting, the selector first, then the carousel, chips and sections", () => {
  const markup = home(central());
  assert.doesNotMatch(markup, /¡Hola|Qué te gustaría comer/);
  const selector = markup.indexOf("Cambiar cafetería");
  const carousel = markup.indexOf("data-carousel");
  const chips = markup.indexOf("Filtrar por categoría");
  const rows = markup.indexOf("Productos:");
  assert.ok(selector >= 0 && selector < carousel, "selector before carousel");
  assert.ok(carousel < chips && chips < rows, "carousel, chips, rows");
  // The compact selector: name, site and state in one line.
  assert.match(markup, /Cafetería Central/);
  assert.match(markup, /Sede Principal/);
  assert.match(markup, />Abierta</);
});

test("Inicio: an empty category has no chip, no section and no «no hay productos» line", () => {
  const menu = central();
  // Every product of the first category stops being available.
  const first = menu.categories[0];
  for (const product of first.products) product.available = false;
  const name = menuDomain.menuCategories.find(({ id }) => id === first.id).name;
  const markup = home(menu);
  assert.doesNotMatch(markup, new RegExp(`>${name}<`));
  assert.doesNotMatch(markup, /No hay productos disponibles/);
});

test("the client nav spreads its items evenly and the cart is never black", () => {
  const css = read("features/client/components/ClientShell.module.css");
  assert.match(css, /\.navItem \{[^}]*flex: 1 1 0/);
  assert.doesNotMatch(css, /:has\(\.cartBadge\)/);
  assert.match(
    css,
    /\.navItem\[aria-current="page"\] \{[^}]*var\(--color-brand-tint\)/,
  );
  // The PWA reaches the screen edges; the header and nav pad with the safe areas.
  assert.match(read("app/layout.tsx"), /viewportFit: "cover"/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test("cart and confirmation are one screen without the removed texts", () => {
  const checkout = read("features/client/components/ClientCheckout.tsx");
  const line = read("features/client/components/CartLineItem.tsx");
  const confirmation = read(
    "features/client/components/CheckoutConfirmation.tsx",
  );
  assert.match(checkout, /<CartLineItem/);
  assert.match(checkout, /<details/);
  assert.match(checkout, /className=\{styles\.bar\}/);
  for (const text of [
    /Total estimado/,
    /términos y condiciones/,
    /Efectivo al recoger/,
    /de \{MAX_CART_UNITS\} unidades/,
  ])
    assert.doesNotMatch(checkout, text);
  assert.doesNotMatch(line, /Cantidad: \{line\.quantity\}/);
  assert.doesNotMatch(confirmation, /efectivo/i);
  assert.match(read("app/cuenta/carrito/page.tsx"), /<ClientCheckout/);
  assert.match(
    read("app/cuenta/carrito/resumen/page.tsx"),
    /redirect\("\/cuenta\/carrito"\)/,
  );
  // The business rules stay: a blocked line still blocks the button.
  assert.match(
    checkout,
    /disabled=\{pending \|\| !!cartIssue \|\| !!pickupError\}/,
  );
});

test("the history shows five orders and keeps «Cargar más»", () => {
  const api = loadTs("features/client-orders/api.ts");
  assert.equal(api.HISTORY_PAGE_SIZE, 5);
  assert.match(
    read("features/client-orders/components/OrderHistory.tsx"),
    /HISTORY_LOAD_MORE/,
  );
});

test("the notice sound is a small icon button with its name", () => {
  const myOrder = read("features/client-orders/components/MyOrder.tsx");
  assert.match(myOrder, /role="switch"/);
  assert.match(myOrder, /aria-label=\{SOUND_TOGGLE_LABEL\}/);
  assert.doesNotMatch(myOrder, /<span>Sonido de avisos<\/span>/);
});

// The change-password flow is covered by tests/client-correcciones.test.mjs.
