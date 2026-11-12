import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const menuDomain = loadTs("features/client/domain/menu.ts");
const cart = loadTs("features/client/domain/cart.ts");
const checkout = loadTs("features/client/domain/checkout.ts");
const fixtures = loadTs("tests/fixtures/client-menu.ts");
const { PRODUCT } = fixtures;
const central = menuDomain.toCafeteriaMenu(
  fixtures.clientMenus[fixtures.CAFETERIA_CENTRAL],
);
const closed = menuDomain.toCafeteriaMenu(
  fixtures.clientMenus[fixtures.CAFETERIA_BLOQUE_B],
);
const add = (state, productId, quantity = 1, menu = central) =>
  cart.addProduct(state, menu, productId, quantity);
const filled = (...entries) =>
  entries.reduce((state, [productId, quantity]) => {
    const result = add(state, productId, quantity);
    assert.equal(result.error, undefined, `${productId}`);
    return result.cart;
  }, cart.emptyCart());

test("§6 limits: 10 units per product and 15 in total", () => {
  assert.equal(cart.MAX_PER_PRODUCT, 10);
  assert.equal(cart.MAX_CART_UNITS, 15);
  const ten = filled([PRODUCT.juice, 10]);
  assert.equal(add(ten, PRODUCT.juice).error, cart.PER_PRODUCT_MESSAGE);
  assert.equal(
    add(cart.emptyCart(), PRODUCT.juice, 11).error,
    cart.PER_PRODUCT_MESSAGE,
  );
  const fifteen = filled([PRODUCT.juice, 10], [PRODUCT.lemonade, 5]);
  assert.equal(cart.cartCount(fifteen), 15);
  assert.equal(add(fifteen, PRODUCT.daily).error, cart.TOTAL_MESSAGE);
  assert.equal(cart.maxQuantity(fifteen, PRODUCT.daily), 0);
  assert.equal(cart.maxQuantity(fifteen, PRODUCT.lemonade), 5);
  assert.equal(cart.maxQuantity(filled([PRODUCT.juice, 8]), PRODUCT.daily), 7);
});

test("breakfast, lunch and drinks can be mixed in one order", () => {
  const mixed = filled(
    [PRODUCT.pericos, 2],
    [PRODUCT.chicken, 1],
    [PRODUCT.juice, 3],
    [PRODUCT.daily, 1],
  );
  assert.equal(mixed.lines.length, 4);
  assert.equal(mixed.cafeteriaId, fixtures.CAFETERIA_CENTRAL);
  assert.equal(cart.validateCart(mixed, central), null);
});

test("adding the same product again adds to its single line; there are no per-line notes", () => {
  const twice = add(filled([PRODUCT.juice, 2]), PRODUCT.juice, 3).cart;
  assert.deepEqual(twice.lines, [{ productId: PRODUCT.juice, quantity: 5 }]);
  assert.equal("notes" in twice.lines[0], false);
});

test("unavailable products and closed cafeterias cannot be added; there is no stock rule", () => {
  assert.equal(
    add(cart.emptyCart(), PRODUCT.fish).error,
    cart.UNAVAILABLE_MESSAGE,
  );
  assert.equal(
    add(cart.emptyCart(), "missing").error,
    cart.UNAVAILABLE_MESSAGE,
  );
  assert.equal(
    add(cart.emptyCart(), PRODUCT.closedCoffee, 1, closed).error,
    cart.CLOSED_MESSAGE,
  );
  assert.equal(
    add(cart.emptyCart(), PRODUCT.juice, 0).error,
    "Elige una cantidad válida.",
  );
  // Ten units of any available product, without stock checks.
  assert.equal(add(cart.emptyCart(), PRODUCT.executive, 10).error, undefined);
});

test("a cart belongs to one cafeteria", () => {
  const otherMenu = structuredClone(central);
  otherMenu.cafeteria = {
    id: fixtures.CAFETERIA_AGUAS_CLARAS,
    name: "Otra",
    open: true,
  };
  const result = add(filled([PRODUCT.juice, 1]), PRODUCT.juice, 1, otherMenu);
  assert.equal(result.error, cart.OTHER_CAFETERIA_MESSAGE);
});

test("quantities are set per product; lowering a stale line always works", () => {
  const state = filled([PRODUCT.juice, 4], [PRODUCT.chicken, 2]);
  assert.deepEqual(
    cart.setQuantity(state, central, PRODUCT.juice, 6).cart.lines[0],
    {
      productId: PRODUCT.juice,
      quantity: 6,
    },
  );
  assert.equal(
    cart.setQuantity(state, central, PRODUCT.juice, 14).error,
    cart.PER_PRODUCT_MESSAGE,
  );
  assert.equal(
    cart.setQuantity(state, central, PRODUCT.juice, -1).error,
    "Elige una cantidad válida.",
  );
  const unavailable = structuredClone(central);
  unavailable.categories.find(
    ({ id }) => id === "BEBIDA",
  ).products[0].available = false;
  assert.equal(
    cart.setQuantity(state, unavailable, PRODUCT.juice, 5).error,
    cart.UNAVAILABLE_MESSAGE,
  );
  // Lowering needs no menu at all, and zero removes the line.
  assert.equal(
    cart.setQuantity(state, null, PRODUCT.juice, 1).cart.lines[0].quantity,
    1,
  );
  const removed = cart.setQuantity(state, null, PRODUCT.juice, 0).cart;
  assert.deepEqual(removed.lines, [
    { productId: PRODUCT.chicken, quantity: 2 },
  ]);
  assert.deepEqual(
    cart.setQuantity(removed, null, PRODUCT.chicken, 0).cart,
    cart.emptyCart(),
  );
});

test("validation blocks closed cafeterias, products that left the menu and unavailable ones", () => {
  const state = filled([PRODUCT.juice, 1], [PRODUCT.chicken, 1]);
  assert.equal(
    cart.validateCart(state, null),
    "No pudimos revisar el menú de tu cafetería.",
  );
  assert.equal(
    cart.validateCart(cart.emptyCart(), central),
    "Agrega al menos un producto a tu carrito.",
  );
  const closedToday = structuredClone(central);
  closedToday.cafeteria.open = false;
  assert.equal(cart.validateCart(state, closedToday), cart.CLOSED_MESSAGE);
  const withoutChicken = structuredClone(central);
  withoutChicken.categories = withoutChicken.categories.filter(
    ({ id }) => id !== "CORRIENTE",
  );
  assert.match(
    cart.validateCart(state, withoutChicken),
    /ya no está en el menú/,
  );
  assert.equal(cart.cartItems(state, withoutChicken)[1].product, null);
  const juiceOff = structuredClone(central);
  juiceOff.categories.find(({ id }) => id === "BEBIDA").products[0].available =
    false;
  assert.equal(
    cart.validateCart(state, juiceOff),
    "Jugo natural no está disponible por ahora. Retíralo para continuar.",
  );
});

test("restored carts keep only ids and quantities and reject corrupt or excessive data", () => {
  const state = filled([PRODUCT.juice, 2], [PRODUCT.daily, 1]);
  assert.deepEqual(cart.restoreCart(JSON.parse(JSON.stringify(state))), state);
  const withExtras = {
    ...state,
    total: 1,
    lines: state.lines.map((line) => ({ ...line, price: 1, name: "X" })),
  };
  assert.deepEqual(cart.restoreCart(withExtras), state);
  for (const value of [
    null,
    "cart",
    {
      siteId: "principal",
      lines: [{ id: "l", mealId: "chicken", quantity: 1, notes: "" }],
    },
    { cafeteriaId: null, lines: [] },
    { cafeteriaId: "../x", lines: [{ productId: PRODUCT.juice, quantity: 1 }] },
    { cafeteriaId: fixtures.CAFETERIA_CENTRAL, lines: [] },
    {
      cafeteriaId: fixtures.CAFETERIA_CENTRAL,
      lines: [{ productId: PRODUCT.juice, quantity: 11 }],
    },
    {
      cafeteriaId: fixtures.CAFETERIA_CENTRAL,
      lines: [{ productId: PRODUCT.juice, quantity: 1.5 }],
    },
    {
      cafeteriaId: fixtures.CAFETERIA_CENTRAL,
      lines: [
        { productId: PRODUCT.juice, quantity: 1 },
        { productId: PRODUCT.juice, quantity: 1 },
      ],
    },
    {
      cafeteriaId: fixtures.CAFETERIA_CENTRAL,
      lines: [
        { productId: PRODUCT.juice, quantity: 10 },
        { productId: PRODUCT.lemonade, quantity: 6 },
      ],
    },
  ])
    assert.deepEqual(
      cart.restoreCart(value),
      cart.emptyCart(),
      JSON.stringify(value),
    );
});

test("the test checkout uses real names and prices and still never sends an order", () => {
  const lunch = new Date("2026-11-20T12:00:00-05:00");
  const state = filled([PRODUCT.juice, 2], [PRODUCT.chicken, 1]);
  assert.equal(checkout.cartMealKind(state, central), "lunch");
  assert.equal(
    checkout.cartMealKind(
      filled([PRODUCT.pericos, 1], [PRODUCT.broth, 1]),
      central,
    ),
    "breakfast",
  );
  const slots = checkout.pickupSlots(state, central, lunch);
  const slot = slots.find((item) => item.available);
  assert.ok(slot);
  assert.equal(slots[0].value, "2026-11-20T16:30:00.000Z");
  assert.equal(
    checkout.reviewCheckout(state, central, slot.value, false, lunch).ok,
    false,
  );
  const result = checkout.reviewCheckout(
    state,
    central,
    slot.value,
    true,
    lunch,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary.lines, [
    { id: PRODUCT.juice, name: "Jugo natural", quantity: 2, unitPrice: 4500 },
    {
      id: PRODUCT.chicken,
      name: "Pechuga a la plancha",
      quantity: 1,
      unitPrice: 15000,
    },
  ]);
  assert.equal(result.summary.total, 24000);
  assert.equal(result.summary.cafeteria, "Cafetería Central");
  const closedToday = structuredClone(central);
  closedToday.cafeteria.open = false;
  assert.deepEqual(
    checkout.reviewCheckout(state, closedToday, slot.value, true, lunch),
    {
      ok: false,
      error: cart.CLOSED_MESSAGE,
    },
  );
});
