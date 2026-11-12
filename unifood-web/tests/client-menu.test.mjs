import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const menu = loadTs("features/client/domain/menu.ts");
const fixtures = loadTs("tests/fixtures/client-menu.ts");
const central = () =>
  structuredClone(fixtures.clientMenus[fixtures.CAFETERIA_CENTRAL]);

test("the real menu keeps the six §6 categories in order, BEBIDA included", () => {
  const parsed = menu.toCafeteriaMenu(central());
  assert.deepEqual(
    parsed.categories.map(({ id }) => id),
    ["DEL_DIA", "DESAYUNO", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "BEBIDA"],
  );
  assert.deepEqual(
    menu.menuCategories.map(({ name }) => name),
    ["Del día", "Desayunos", "Corriente", "Ejecutivo", "Especial", "Bebidas"],
  );
  const juice = menu.findProduct(parsed, fixtures.PRODUCT.juice);
  assert.deepEqual(juice, {
    id: fixtures.PRODUCT.juice,
    name: "Jugo natural",
    description: null,
    price: 4500,
    available: true,
    category: "BEBIDA",
  });
  // imageUrl is never used: every product shows its initial.
  assert.equal("imageUrl" in juice, false);
});

test("categories arrive in any order but are shown in the filter order", () => {
  const body = central();
  body.categories.reverse();
  assert.deepEqual(
    menu.toCafeteriaMenu(body).categories.map(({ id }) => id),
    ["DEL_DIA", "DESAYUNO", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "BEBIDA"],
  );
});

test("malformed products and unknown categories are dropped one by one", () => {
  const body = central();
  body.categories[5].products.push(
    { id: "x1", name: "Sin precio", available: true },
    { id: "x2", name: "Precio raro", price: "4.500", available: true },
    { id: "x3", name: "Cero", price: "0.00", available: true },
    { id: "x4", name: "  ", price: "1000.00", available: true },
    { id: "x5", name: "Sin disponibilidad", price: "1000.00" },
    {
      id: "x6",
      name: "Número",
      price: 2500,
      available: false,
      description: " ",
    },
    null,
    "texto",
  );
  body.categories.push(
    {
      id: "POSTRE",
      products: [{ id: "x7", name: "Flan", price: "3000", available: true }],
    },
    {
      id: "BEBIDA",
      products: [{ id: "x8", name: "Repetida", price: "1", available: true }],
    },
    { id: "DESAYUNO" },
  );
  const parsed = menu.toCafeteriaMenu(body);
  const drinks = parsed.categories.find(({ id }) => id === "BEBIDA").products;
  assert.deepEqual(
    drinks.map(({ id }) => id),
    [fixtures.PRODUCT.juice, fixtures.PRODUCT.lemonade, "x6"],
  );
  assert.equal(drinks[2].price, 2500);
  assert.equal(drinks[2].description, null);
  assert.equal(menu.findProduct(parsed, "x7"), undefined);
  assert.equal(menu.findProduct(parsed, "x8"), undefined);
  assert.equal(
    parsed.categories.find(({ id }) => id === "DESAYUNO").products.length,
    2,
  );
});

test("a product repeated in two categories keeps its first appearance", () => {
  const body = central();
  body.categories[5].products.push({
    ...body.categories[0].products[0],
    name: "Duplicado",
  });
  const parsed = menu.toCafeteriaMenu(body);
  assert.equal(
    menu.menuProducts(parsed).filter(({ id }) => id === fixtures.PRODUCT.daily)
      .length,
    1,
  );
  assert.equal(
    menu.findProduct(parsed, fixtures.PRODUCT.daily).category,
    "DEL_DIA",
  );
});

test("a closed cafeteria never offers products, whatever each one says", () => {
  const body = central();
  body.cafeteria.open = false;
  const parsed = menu.toCafeteriaMenu(body);
  assert.equal(parsed.cafeteria.open, false);
  assert.ok(menu.menuProducts(parsed).every(({ available }) => !available));
  assert.ok(
    menu
      .menuProducts(parsed)
      .every((product) => !menu.canOrder(parsed, product)),
  );
  const closed = menu.toCafeteriaMenu(
    fixtures.clientMenus[fixtures.CAFETERIA_BLOQUE_B],
  );
  assert.equal(menu.menuProducts(closed).length, 2);
});

test("an empty menu is valid; an unexpected top level is not", () => {
  const empty = menu.toCafeteriaMenu(
    fixtures.clientMenus[fixtures.CAFETERIA_AGUAS_CLARAS],
  );
  assert.deepEqual(empty.categories, []);
  for (const payload of [
    null,
    [],
    "menu",
    { categories: [] },
    { ...central(), categories: null },
    { ...central(), cafeteria: { id: "c", name: "C" } },
    { ...central(), businessDate: "" },
    { sites: [] },
  ])
    assert.equal(menu.toCafeteriaMenu(payload), null);
});

test("links carry the real cafeteria and product ids", () => {
  assert.equal(
    menu.productHref(fixtures.CAFETERIA_CENTRAL, fixtures.PRODUCT.juice),
    `/cuenta/producto/${fixtures.PRODUCT.juice}?cafeteria=${fixtures.CAFETERIA_CENTRAL}`,
  );
  assert.equal(
    menu.menuHref(fixtures.CAFETERIA_CENTRAL, "bebidas"),
    `/cuenta/menu?cafeteria=${fixtures.CAFETERIA_CENTRAL}&categoria=bebidas`,
  );
  assert.equal(menu.findCategoryBySlug("bebidas").id, "BEBIDA");
  assert.equal(menu.findCategoryBySlug(["bebidas"]), undefined);
  assert.equal(menu.findCategoryBySlug("BEBIDA"), undefined);
});

function serverMenu({
  auth = {
    accessToken: "verified",
    profile: { id: "u", active: true, roles: ["CLIENT"] },
  },
  respond,
} = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      return respond();
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return {
    calls,
    loadCafeteriaMenu: load("features/client/server/menu.ts").loadCafeteriaMenu,
  };
}

test("the server menu goes through the BFF forward with the session bearer", async () => {
  const { calls, loadCafeteriaMenu } = serverMenu({
    respond: () => Response.json(central(), { headers: { etag: '"1"' } }),
  });
  const result = await loadCafeteriaMenu(fixtures.CAFETERIA_CENTRAL);
  assert.equal(result.status, "ok");
  assert.equal(result.menu.cafeteria.name, "Cafetería Central");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `http://backend.test:8080/api/me/menu?cafeteriaId=${fixtures.CAFETERIA_CENTRAL}`,
  );
  assert.equal(calls[0].options.headers.authorization, "Bearer verified");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal);
});

test("the server menu maps Spring errors to fixed screen states", async () => {
  const cases = [
    [404, { code: "CAFETERIA_NOT_FOUND", message: "PRIVATE" }, "unavailable"],
    [
      403,
      { code: "CAFETERIA_NOT_SUBSCRIBED", message: "PRIVATE" },
      "unavailable",
    ],
    [503, { code: "X", message: "PRIVATE" }, "error"],
    [500, { message: "PRIVATE" }, "error"],
    [401, { message: "PRIVATE" }, "error"],
    [200, { sites: [] }, "error"],
    // A menu for another cafeteria is never shown as this one.
    [200, fixtures.clientMenus[fixtures.CAFETERIA_BLOQUE_B], "error"],
  ];
  for (const [status, body, expected] of cases) {
    const { loadCafeteriaMenu } = serverMenu({
      respond: () => Response.json(body, { status }),
    });
    assert.deepEqual(
      await loadCafeteriaMenu(fixtures.CAFETERIA_CENTRAL),
      { status: expected },
      `${status}`,
    );
  }
  const network = serverMenu({
    respond: () => {
      throw new TypeError("connect ECONNREFUSED PRIVATE");
    },
  });
  assert.deepEqual(
    await network.loadCafeteriaMenu(fixtures.CAFETERIA_CENTRAL),
    {
      status: "error",
    },
  );
});

test("the server menu never calls Spring without a session or with a malformed id", async () => {
  const anonymous = serverMenu({
    auth: null,
    respond: () => Response.json(central()),
  });
  assert.deepEqual(
    await anonymous.loadCafeteriaMenu(fixtures.CAFETERIA_CENTRAL),
    {
      status: "error",
    },
  );
  assert.equal(anonymous.calls.length, 0);
  const malformed = serverMenu({ respond: () => Response.json(central()) });
  assert.deepEqual(await malformed.loadCafeteriaMenu("../admin"), {
    status: "error",
  });
  assert.equal(malformed.calls.length, 0);
});
