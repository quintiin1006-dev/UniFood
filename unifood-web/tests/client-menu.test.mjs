import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const menu = loadTs("features/client/domain/menu.ts");
const cart = loadTs("features/client/domain/cart.ts");

const dish = (overrides = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  cafeteriaId: "22222222-2222-2222-2222-222222222222",
  cafeteriaName: "Cafetería Central",
  name: "Pollo",
  description: "Con arroz",
  price: 15000,
  imageUrl: "/images/client/chicken.png",
  stock: 12,
  category: "CORRIENTE",
  availableToday: true,
  ...overrides,
});
const site = (overrides = {}, meals = [dish()]) => ({
  id: "33333333-3333-3333-3333-333333333333",
  name: "Sede Principal",
  city: "Villavicencio",
  imageUrl: "/images/client/campus.png",
  meals,
  ...overrides,
});
const parseDish = (overrides) =>
  menu.toClientMenu({ sites: [site({}, [dish(overrides)])] }).sites[0].meals[0];

test("unexpected payloads become an unavailable menu instead of a crash", () => {
  for (const payload of [null, "menu", [], {}, { sites: "x" }])
    assert.deepEqual(menu.toClientMenu(payload), {
      sites: [],
      unavailable: true,
    });
});

test("a malformed dish is dropped without hiding its siblings or site", () => {
  const parsed = menu.toClientMenu({
    sites: [
      site({}, [
        dish({ id: "a", name: "Válido" }),
        dish({ id: "b", price: -5 }),
        dish({ id: "c", category: "BEBIDAS" }),
        dish({ id: "d", category: "constructor" }),
        dish({ id: "e", stock: -1 }),
        dish({ id: "f", name: "" }),
        dish({ id: "g", cafeteriaName: null }),
        dish({ id: "h", availableToday: "yes" }),
        dish({ id: "i", price: "12.345" }),
      ]),
    ],
  });
  assert.equal(parsed.unavailable, false);
  assert.deepEqual(
    parsed.sites[0].meals.map((meal) => meal.name),
    ["Válido"],
  );
});

test("the backend's catalog categories map to sections and service kinds", () => {
  const expected = {
    DESAYUNO: ["desayunos", "breakfast"],
    DEL_DIA: ["del-dia", "lunch"],
    CORRIENTE: ["corriente", "lunch"],
    EJECUTIVO: ["ejecutivos", "lunch"],
    ESPECIAL: ["especiales", "lunch"],
  };
  for (const [category, [section, kind]] of Object.entries(expected)) {
    const meal = parseDish({ category });
    assert.equal(meal.category, section);
    assert.equal(meal.kind, kind);
  }
});

test("prices keep their exact value as a JSON number or a decimal string", () => {
  assert.equal(parseDish({ price: 15000 }).price, 15000);
  assert.equal(parseDish({ price: "18500.25" }).price, 18500.25);
  assert.equal(parseDish({ price: "15000" }).price, 15000);
});

test("today's availability decides whether the dish can be offered", () => {
  assert.deepEqual(
    parseDish({ availableToday: true }).availableDays,
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(parseDish({ availableToday: false }).availableDays, []);
});

test("missing or remote images fall back so next/image never throws", () => {
  for (const imageUrl of [
    null,
    "https://cdn.example.invalid/a.png",
    "//cdn.example.invalid/a.png",
    "/\\cdn.example.invalid/a.png",
  ])
    assert.equal(parseDish({ imageUrl }).image, "/unifood-logo.png");
  assert.equal(
    parseDish({ imageUrl: "/images/client/chicken.png" }).image,
    "/images/client/chicken.png",
  );
});

test("a site without a valid id is ignored; the cafeteria comes from its dishes", () => {
  const parsed = menu.toClientMenu({
    sites: [
      site({ id: "" }),
      site({ imageUrl: null }),
      site({ id: "empty", name: "Sede sin platos" }, []),
    ],
  });
  assert.equal(parsed.sites.length, 2);
  assert.equal(parsed.sites[0].image, "/unifood-logo.png");
  assert.equal(parsed.sites[0].cafeteria, "Cafetería Central");
  assert.equal(parsed.sites[1].cafeteria, "Sede sin platos");
});

test("a dish withdrawn from the menu costs its line, not the whole cart", () => {
  const parsed = menu.toClientMenu({
    sites: [site({ id: "s" }, [dish({ id: "kept" })])],
  });
  const line = (id, mealId) => ({ id, mealId, quantity: 1, notes: "" });
  assert.deepEqual(
    cart.restoreCart(parsed, {
      siteId: "s",
      lines: [line("l1", "kept"), line("l2", "withdrawn")],
    }).lines,
    [line("l1", "kept")],
  );
  assert.deepEqual(
    cart.restoreCart(parsed, { siteId: "s", lines: [line("l1", "withdrawn")] }),
    cart.emptyCart(),
  );
});
