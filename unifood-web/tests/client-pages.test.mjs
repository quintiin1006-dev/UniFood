import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

const fixtures = loadTs("tests/fixtures/client-menu.ts");
const contextDomain = loadTs("features/client/domain/context.ts");
const menuDomain = loadTs("features/client/domain/menu.ts");
const context = contextDomain.toClientContext(fixtures.clientContext);
const menus = Object.fromEntries(
  Object.entries(fixtures.clientMenus).map(([id, body]) => [
    id,
    menuDomain.toCafeteriaMenu(body),
  ]),
);
const client = {
  id: "client-id",
  fullName: "Ana María Pérez",
  active: true,
  roles: ["CLIENT"],
};

class Redirect extends Error {}
class NotFound extends Error {}
const component = (name) => {
  const fn = () => null;
  fn.displayName = name;
  return fn;
};
const components = Object.fromEntries(
  [
    "CafeteriaUnavailable",
    "ClientHome",
    "ClientMenu",
    "ClientProduct",
    "MenuUnavailable",
    "SiteSelection",
  ].map((name) => [
    `@/features/client/components/${name}`,
    { __esModule: true, default: component(name) },
  ]),
);

function pages({ contextResult = { status: "ok", context }, menuFor } = {}) {
  const menuCalls = [];
  const load = availabilityLoader({
    mocks: {
      ...components,
      "next/navigation": {
        redirect: (to) => {
          throw new Redirect(to);
        },
        notFound: () => {
          throw new NotFound();
        },
      },
      "@/features/auth/server/session": {
        requireAuth: async () => ({ profile: client }),
      },
      "@/features/client/server/context": {
        loadClientContext: async () => contextResult,
      },
      "@/features/client/server/menu": {
        loadCafeteriaMenu: async (id) => {
          menuCalls.push(id);
          if (menuFor) return menuFor(id);
          return menus[id]
            ? { status: "ok", menu: menus[id] }
            : { status: "unavailable" };
        },
      },
    },
  });
  return {
    menuCalls,
    home: load("app/cuenta/page.tsx").default,
    menu: load("app/cuenta/menu/page.tsx").default,
    product: load("app/cuenta/producto/[productId]/page.tsx").default,
  };
}
const render = (page, query = {}, params) =>
  page({
    searchParams: Promise.resolve(query),
    params: Promise.resolve(params),
  });
const name = (element) => element.type.displayName;

test("Inicio shows the selection, then the chosen cafeteria's real menu", async () => {
  const { home, menuCalls } = pages();
  const selection = await render(home);
  assert.equal(name(selection), "SiteSelection");
  assert.equal(selection.props.selection.view, "sites");
  assert.equal(selection.props.ownerId, "client-id");
  assert.equal(menuCalls.length, 0);
  const chosen = await render(home, { cafeteria: fixtures.CAFETERIA_CENTRAL });
  assert.equal(name(chosen), "ClientHome");
  assert.equal(chosen.props.siteName, "Sede Principal");
  assert.equal(chosen.props.fullName, "Ana María Pérez");
  assert.equal(chosen.props.menu.cafeteria.id, fixtures.CAFETERIA_CENTRAL);
  assert.deepEqual(menuCalls, [fixtures.CAFETERIA_CENTRAL]);
});

test("Inicio never asks the menu of a cafeteria the context does not list", async () => {
  const { home, menuCalls } = pages();
  const stale = await render(home, {
    cafeteria: "00000000-0000-4000-8000-999999999999",
  });
  assert.equal(name(stale), "SiteSelection");
  assert.equal(stale.props.selection.stale, true);
  assert.equal(menuCalls.length, 0);
});

test("Inicio states: closed and empty menus render; failures are fixed messages", async () => {
  const { home } = pages();
  const closed = await render(home, { cafeteria: fixtures.CAFETERIA_BLOQUE_B });
  assert.equal(name(closed), "ClientHome");
  assert.equal(closed.props.menu.cafeteria.open, false);
  const empty = await render(home, {
    cafeteria: fixtures.CAFETERIA_AGUAS_CLARAS,
  });
  assert.deepEqual(empty.props.menu.categories, []);
  // The failing cafeteria has no menu in the map: Spring answered 404 or 403.
  assert.equal(
    name(await render(home, { cafeteria: fixtures.CAFETERIA_FAILING })),
    "CafeteriaUnavailable",
  );
  const failing = pages({ menuFor: () => ({ status: "error" }) });
  const retry = await render(failing.home, {
    cafeteria: fixtures.CAFETERIA_CENTRAL,
  });
  assert.equal(name(retry), "MenuUnavailable");
  assert.equal(retry.props.title, undefined);
  const noContext = pages({ contextResult: { status: "error" } });
  const contextError = await render(noContext.home);
  assert.equal(name(contextError), "MenuUnavailable");
  assert.equal(contextError.props.title, "No pudimos cargar tus cafeterías");
});

test("Menú validates the cafeteria and the category slug", async () => {
  const { menu } = pages();
  const all = await render(menu, { cafeteria: fixtures.CAFETERIA_CENTRAL });
  assert.equal(name(all), "ClientMenu");
  assert.equal(all.props.categoryId, null);
  const drinks = await render(menu, {
    cafeteria: fixtures.CAFETERIA_CENTRAL,
    categoria: "bebidas",
  });
  assert.equal(drinks.props.categoryId, "BEBIDA");
  await assert.rejects(
    render(menu, {
      cafeteria: fixtures.CAFETERIA_CENTRAL,
      categoria: "postres",
    }),
    new Redirect(`/cuenta/menu?cafeteria=${fixtures.CAFETERIA_CENTRAL}`),
  );
  await assert.rejects(render(menu, {}), new Redirect("/cuenta"));
  await assert.rejects(
    render(menu, { cafeteria: "otra" }),
    new Redirect("/cuenta?cafeteria=otra"),
  );
});

test("Producto finds the real productId; an unknown one is not found", async () => {
  const { product } = pages();
  const found = await render(
    product,
    { cafeteria: fixtures.CAFETERIA_CENTRAL },
    { productId: fixtures.PRODUCT.fish },
  );
  assert.equal(name(found), "ClientProduct");
  assert.equal(found.props.product.name, "Filete de pescado");
  assert.equal(found.props.product.available, false);
  await assert.rejects(
    render(
      product,
      { cafeteria: fixtures.CAFETERIA_CENTRAL },
      { productId: "chicken" },
    ),
    NotFound,
  );
  // A product of another cafeteria is not found in this one.
  await assert.rejects(
    render(
      product,
      { cafeteria: fixtures.CAFETERIA_CENTRAL },
      { productId: fixtures.PRODUCT.closedCoffee },
    ),
    NotFound,
  );
  await assert.rejects(
    render(product, {}, { productId: fixtures.PRODUCT.juice }),
    new Redirect("/cuenta"),
  );
});
