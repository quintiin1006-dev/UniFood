import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 5 (docs/propuesta-menu-dinamico.md 4.4): the card's pure logic.

const load = availabilityLoader();
const contracts = load("features/daily-menu/contracts.ts");
const state = load("features/daily-menu/state.ts");
const presentation = load("features/daily-menu/presentation.ts");
const errors = load("features/daily-menu/errors.ts");
const { SKIP } = load("features/daily-menu/types.ts");
const messages = load("features/shared/messages.ts");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CAFETERIA = id(1);

const payload = (categories) => ({
  cafeteria: { id: CAFETERIA, name: "Central", open: true },
  businessDate: "2026-11-21",
  title: "Almuerzo del día",
  price: "9500.00",
  categories,
});
const single = (n, label, options, canSkip = false) => ({
  id: id(n),
  label,
  kind: "SINGLE",
  canSkip,
  options: options.map((option, index) => ({
    id: id(n * 100 + index),
    label: option,
  })),
});
const additions = (n, items) => ({
  id: id(n),
  label: "Adiciones",
  kind: "ADDITIONS",
  canSkip: true,
  additions: items.map(([name, extraPrice], index) => ({
    id: id(n * 100 + index),
    name,
    extraPrice,
  })),
});

const full = () =>
  contracts.toClientDailyMenu(
    payload([
      additions(9, [["Huevo frito", "2000.00"]]),
      single(2, "Proteína", ["Pollo", "Res"]),
      single(3, "Principio", ["Frijol"]),
      single(4, "Bebida", ["Limonada"], true),
      single(5, "Complementos", [], true),
    ]),
  );

test("empty categories are dropped and ADDITIONS goes last, template order kept", () => {
  const menu = full();
  assert.deepEqual(
    menu.categories.map(({ label }) => label),
    ["Proteína", "Principio", "Bebida", "Adiciones"],
  );
  const noAdditions = contracts.toClientDailyMenu(
    payload([single(2, "Proteína", ["Pollo"]), additions(9, [])]),
  );
  assert.deepEqual(
    noAdditions.categories.map(({ kind }) => kind),
    ["SINGLE"],
  );
  // Without any SINGLE with options, no card at all.
  assert.equal(
    contracts.toClientDailyMenu(payload([single(5, "Bebida", [], true)])),
    null,
  );
});

test("prices arrive as decimal strings and only well-formed menus pass", () => {
  const menu = full();
  assert.equal(menu.price, 9500);
  assert.equal(menu.categories[3].additions[0].extraPrice, 2000);
  for (const broken of [
    { ...payload([]), price: 9500 },
    { ...payload([]), price: "9.500" },
    { ...payload([]), cafeteria: { id: "x", name: "C", open: true } },
    payload([{ ...single(2, "P", ["A"]), kind: "OTHER" }]),
    payload([single(2, "P", ["x".repeat(351)])]),
  ])
    assert.equal(contracts.pickDailyMenu(broken), null);
  // Unknown fields never survive the pick.
  const picked = contracts.pickDailyMenu({
    ...payload([{ ...single(2, "P", ["A"]), version: 7 }]),
    publishedBy: "worker",
  });
  assert.equal("publishedBy" in picked, false);
  assert.equal("version" in picked.categories[0], false);
});

test("what is missing: one choice per visible SINGLE, «Ninguna» only when skippable", () => {
  const menu = full();
  let selection = state.EMPTY_SELECTION;
  assert.deepEqual(state.missingChoices(menu, selection), [
    "Proteína",
    "Principio",
    "Bebida",
  ]);
  selection = state.choose(selection, id(2), id(200));
  selection = state.choose(selection, id(2), id(201));
  assert.equal(selection.choices[id(2)], id(201), "a new choice replaces");
  selection = state.choose(selection, id(3), SKIP);
  assert.deepEqual(
    state.missingChoices(menu, selection),
    ["Principio", "Bebida"],
    "Principio cannot be skipped",
  );
  selection = state.choose(selection, id(3), id(300));
  selection = state.choose(selection, id(4), SKIP);
  assert.deepEqual(state.missingChoices(menu, selection), []);
  assert.deepEqual(state.selectionProgress(menu, selection), {
    done: 3,
    total: 3,
  });
  // Additions are optional and toggle.
  selection = state.toggleAddition(selection, id(900));
  assert.deepEqual(selection.additionIds, [id(900)]);
  selection = state.toggleAddition(selection, id(900));
  assert.deepEqual(selection.additionIds, []);
  // An option that is no longer on the menu does not count.
  assert.deepEqual(
    state.missingChoices(
      menu,
      state.choose(state.EMPTY_SELECTION, id(2), id(999)),
    ),
    ["Proteína", "Principio", "Bebida"],
  );
  assert.equal(state.DEFAULT_OPEN, false);
});

test("presentation uses the app's currency and the catalogue texts", () => {
  const { currency } = load("features/client/domain/catalog.ts");
  assert.equal(presentation.formatPrice(9500), currency.format(9500));
  assert.equal(presentation.formatExtra(2000), `+ ${currency.format(2000)}`);
  assert.equal(
    presentation.missingText(["Principio", "Bebida"]),
    "Falta elegir: Principio, Bebida",
  );
  assert.equal(presentation.missingText([]), null);
  assert.equal(messages.dailyMenuProgress(2, 4), "2 de 4 elegidas");
});

test("error codes map to the catalogue and never leak raw text", () => {
  assert.equal(
    errors.dailyMenuErrorMessage("DAILY_MENU_NOT_PUBLISHED"),
    messages.BACKEND_ERROR_MESSAGES.DAILY_MENU_NOT_PUBLISHED,
  );
  assert.equal(
    errors.dailyMenuErrorMessage("DAILY_MENU_DISABLED"),
    messages.BACKEND_ERROR_MESSAGES.DAILY_MENU_DISABLED,
  );
  const generic = errors.dailyMenuErrorMessage("NOPE");
  assert.equal(errors.dailyMenuErrorMessage("java.lang.Oops: boom"), generic);
  assert.equal(errors.dailyMenuErrorMessage(undefined), generic);
});

const ORDER = [
  "DEL_DIA",
  "DESAYUNO",
  "CORRIENTE",
  "EJECUTIVO",
  "ESPECIAL",
  "BEBIDA",
];

test("without the card, Inicio keeps «Del día» and «Corriente» exactly as today", () => {
  const layout = state.homeLayout({
    order: ORDER,
    withProducts: ["DEL_DIA", "DESAYUNO", "CORRIENTE", "BEBIDA"],
    replacing: false,
    filter: null,
  });
  assert.equal(state.DAILY_MENU_SLOT, "DEL_DIA");
  assert.equal(state.DAILY_MENU_REPLACES, undefined);
  assert.equal(layout.showCard, false);
  assert.deepEqual(layout.filterIds, [
    "DEL_DIA",
    "DESAYUNO",
    "CORRIENTE",
    "BEBIDA",
  ]);
  assert.deepEqual(layout.sectionIds, [
    "DEL_DIA",
    "DESAYUNO",
    "CORRIENTE",
    "BEBIDA",
  ]);
  const filtered = state.homeLayout({
    order: ORDER,
    withProducts: ["DEL_DIA", "CORRIENTE"],
    replacing: false,
    filter: "DEL_DIA",
  });
  assert.deepEqual(filtered.sectionIds, ["DEL_DIA"]);
  assert.equal(filtered.showCard, false);
  // An empty «Del día» has no chip without the card, as today.
  assert.deepEqual(
    state.homeLayout({
      order: ORDER,
      withProducts: ["CORRIENTE"],
      replacing: false,
      filter: null,
    }).filterIds,
    ["CORRIENTE"],
  );
});

test("with the card, it takes «Del día»'s place and «Corriente» stays visible", () => {
  const all = state.homeLayout({
    order: ORDER,
    withProducts: ["DEL_DIA", "DESAYUNO", "CORRIENTE", "BEBIDA"],
    replacing: true,
    filter: null,
  });
  assert.equal(all.showCard, true, "visible with «Todo»");
  assert.deepEqual(all.sectionIds, ["DESAYUNO", "CORRIENTE", "BEBIDA"]);
  assert.deepEqual(all.filterIds, [
    "DEL_DIA",
    "DESAYUNO",
    "CORRIENTE",
    "BEBIDA",
  ]);

  const delDia = state.homeLayout({
    order: ORDER,
    withProducts: ["DEL_DIA", "CORRIENTE"],
    replacing: true,
    filter: "DEL_DIA",
  });
  assert.equal(delDia.active, "DEL_DIA");
  assert.equal(
    delDia.showCard,
    true,
    "the «Del día» filter shows only the card",
  );
  assert.deepEqual(delDia.sectionIds, []);

  const corriente = state.homeLayout({
    order: ORDER,
    withProducts: ["DESAYUNO", "CORRIENTE"],
    replacing: true,
    filter: "CORRIENTE",
  });
  assert.equal(corriente.showCard, false, "hidden with the other filters");
  assert.deepEqual(corriente.sectionIds, ["CORRIENTE"]);

  // The «Del día» chip is first and stays for the card even with no «Del día» products.
  const noProducts = state.homeLayout({
    order: ORDER,
    withProducts: ["CORRIENTE", "BEBIDA"],
    replacing: true,
    filter: null,
  });
  assert.deepEqual(noProducts.filterIds, ["DEL_DIA", "CORRIENTE", "BEBIDA"]);
  assert.deepEqual(noProducts.sectionIds, ["CORRIENTE", "BEBIDA"]);
  // A filter no longer on the chips falls back to «Todo».
  assert.equal(
    state.homeLayout({
      order: ORDER,
      withProducts: ["BEBIDA"],
      replacing: false,
      filter: "DEL_DIA",
    }).active,
    null,
  );
});

test("the live menu carries dailyMenu.available as a strict boolean", () => {
  const { toCafeteriaMenu } = load("features/client/domain/menu.ts");
  const base = {
    cafeteria: { id: CAFETERIA, name: "C", open: true },
    businessDate: "2026-11-21",
    categories: [],
  };
  assert.equal(
    toCafeteriaMenu({ ...base, dailyMenu: { available: true } })
      .dailyMenuAvailable,
    true,
  );
  assert.equal(
    toCafeteriaMenu({ ...base, dailyMenu: { available: "true" } })
      .dailyMenuAvailable,
    false,
  );
  assert.equal(toCafeteriaMenu(base).dailyMenuAvailable, false);
});
