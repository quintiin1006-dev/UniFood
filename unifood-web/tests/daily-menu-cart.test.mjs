import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 6 (docs/propuesta-menu-dinamico.md 4.6 and 5): the daily menu plate in the cart.

const load = availabilityLoader();
const contracts = load("features/daily-menu/contracts.ts");
const cart = load("features/client/domain/cart.ts");
const checkout = load("features/client/domain/checkout.ts");
const errors = load("features/client/errors.ts");
const messages = load("features/shared/messages.ts");
const { SKIP } = load("features/daily-menu/types.ts");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CAFETERIA = id(1);
const PRODUCT = id(70);
const DAY = "2026-11-22";

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
const daily = ({
  date = DAY,
  open = true,
  protein = ["Pollo", "Res"],
  extras = [["Huevo frito", "2000.00"]],
} = {}) =>
  contracts.toClientDailyMenu({
    cafeteria: { id: CAFETERIA, name: "Central", open },
    businessDate: date,
    title: "Almuerzo del día",
    price: "9500.00",
    categories: [
      single(2, "Proteína", protein),
      single(4, "Bebida", ["Limonada"], true),
      // Skippable and empty today: hidden on the card, still «Ninguna» for Spring.
      single(5, "Complementos", [], true),
      {
        id: id(9),
        label: "Adiciones",
        kind: "ADDITIONS",
        canSkip: true,
        additions: extras.map(([name, extraPrice], index) => ({
          id: id(900 + index),
          name,
          extraPrice,
        })),
      },
    ],
  });
const choice = {
  choices: { [id(2)]: id(200), [id(4)]: SKIP },
  additionIds: [id(900)],
};
const catalogue = (open = true) => ({
  cafeteria: { id: CAFETERIA, name: "Central", open },
  businessDate: DAY,
  categories: [
    {
      id: "BEBIDA",
      products: [
        {
          id: PRODUCT,
          name: "Jugo",
          description: null,
          price: 4000,
          available: true,
          category: "BEBIDA",
        },
      ],
    },
  ],
  dailyMenuAvailable: true,
});
const withPlate = (
  base = cart.emptyCart(),
  menu = daily(),
  selection = choice,
) => {
  const result = cart.setMenuLine(base, menu, selection);
  assert.equal(result.error, undefined);
  return result.cart;
};

test("the cart line is a union: product lines stay as they were, the plate has kind menu", () => {
  const products = cart.addProduct(
    cart.emptyCart(),
    catalogue(),
    PRODUCT,
    2,
  ).cart;
  const state = withPlate(products);
  assert.deepEqual(state.lines[0], { productId: PRODUCT, quantity: 2 });
  assert.deepEqual(cart.menuLine(state), {
    kind: "menu",
    businessDate: DAY,
    choices: { [id(2)]: id(200), [id(4)]: "NONE", [id(5)]: "NONE" },
    additionIds: [id(900)],
  });
  assert.equal(cart.productLines(state).length, 1);
  assert.deepEqual(cart.selectionFromLine(cart.menuLine(state)).choices, {
    [id(2)]: id(200),
    [id(4)]: SKIP,
    [id(5)]: SKIP,
  });
  // Changing products keeps the plate; removing the plate keeps the products.
  const more = cart.setQuantity(state, catalogue(), PRODUCT, 3).cart;
  assert.ok(cart.menuLine(more));
  assert.equal(cart.quantityInCart(more, PRODUCT), 3);
  assert.deepEqual(cart.removeMenuLine(more).lines, [
    { productId: PRODUCT, quantity: 3 },
  ]);
  assert.deepEqual(cart.removeMenuLine(withPlate()), cart.emptyCart());
});

test("one plate per cart: adding again replaces it; an incomplete choice is refused", () => {
  const first = withPlate();
  const second = withPlate(first, daily(), {
    choices: { [id(2)]: id(201), [id(4)]: id(400) },
    additionIds: [],
  });
  assert.equal(second.lines.filter(cart.isMenuLine).length, 1);
  assert.equal(cart.menuLine(second).choices[id(2)], id(201));
  assert.equal(
    cart.setMenuLine(cart.emptyCart(), daily(), {
      choices: {},
      additionIds: [],
    }).error,
    messages.DAILY_MENU_PENDING_CHOICE,
  );
  // «Ninguna» only where it may be skipped.
  assert.equal(
    cart.setMenuLine(cart.emptyCart(), daily(), {
      choices: { [id(2)]: SKIP, [id(4)]: SKIP },
      additionIds: [],
    }).error,
    messages.DAILY_MENU_PENDING_CHOICE,
  );
  assert.equal(
    cart.setMenuLine(cart.emptyCart(), daily({ open: false }), choice).error,
    cart.CLOSED_MESSAGE,
  );
  const other = {
    cafeteriaId: id(3),
    lines: [{ productId: PRODUCT, quantity: 1 }],
  };
  assert.equal(
    cart.setMenuLine(other, daily(), choice).error,
    cart.OTHER_CAFETERIA_MESSAGE,
  );
});

test("limits: the plate is 1 unit of the 15 and its additions do not count", () => {
  const fourteen = {
    cafeteriaId: CAFETERIA,
    lines: [
      { productId: PRODUCT, quantity: 10 },
      { productId: id(71), quantity: 4 },
    ],
  };
  const fifteen = withPlate(
    fourteen,
    daily({
      extras: [
        ["A", "1000.00"],
        ["B", "1000.00"],
      ],
    }),
    {
      ...choice,
      additionIds: [id(900), id(901)],
    },
  );
  assert.equal(cart.cartCount(fifteen), 15);
  assert.equal(cart.maxQuantity(fifteen, id(71)), 4);
  // Replacing the plate in a full cart is allowed; one more product is not.
  assert.equal(cart.setMenuLine(fifteen, daily(), choice).error, undefined);
  const full = {
    ...fourteen,
    lines: [...fourteen.lines, { productId: id(72), quantity: 1 }],
  };
  assert.equal(
    cart.setMenuLine(full, daily(), choice).error,
    cart.TOTAL_MESSAGE,
  );
});

test("restoring keeps the same key's shape and drops what it does not understand", () => {
  const state = withPlate(
    cart.addProduct(cart.emptyCart(), catalogue(), PRODUCT, 1).cart,
  );
  assert.deepEqual(cart.restoreCart(JSON.parse(JSON.stringify(state))), state);
  const plate = cart.menuLine(state);
  const products = [{ productId: PRODUCT, quantity: 1 }];
  const restored = (lines) =>
    cart.restoreCart({ cafeteriaId: CAFETERIA, lines });
  // Extra fields (a price) are never kept.
  assert.deepEqual(
    cart.menuLine(restored([...products, { ...plate, price: 1, title: "X" }])),
    plate,
  );
  for (const bad of [
    { kind: "combo", productId: PRODUCT, quantity: 1 },
    { ...plate, businessDate: "ayer" },
    { ...plate, choices: [] },
    { ...plate, choices: {} },
    { ...plate, choices: { "../x": "NONE" } },
    { ...plate, choices: { [id(2)]: "otra" } },
    { ...plate, additionIds: [id(900), id(900)] },
    { ...plate, additionIds: "x" },
  ])
    assert.deepEqual(
      restored([...products, bad]).lines,
      products,
      JSON.stringify(bad),
    );
  // Two plates: neither is trusted. Only an unknown plate: an empty cart.
  assert.deepEqual(restored([...products, plate, plate]).lines, products);
  assert.deepEqual(restored([{ ...plate, businessDate: 1 }]), cart.emptyCart());
  // Lines saved before the daily menu still restore as products.
  assert.deepEqual(restored(products).lines, products);
});

// «Pollo» sold out after the client chose it: only «Res» is left today.
const soldOut = () => {
  const menu = daily();
  menu.categories[0].options = menu.categories[0].options.slice(1);
  return menu;
};

test("validateCart (section 5): the plate must still match today's published menu", () => {
  const state = withPlate();
  const ok = daily();
  assert.equal(cart.validateCart(state, catalogue(), ok), null);
  assert.equal(cart.menuLineStatus(cart.menuLine(state), ok, CAFETERIA), "ok");
  // Unpublished, flag off or another day: «Ya no está disponible», never sent.
  for (const menu of [null, daily({ date: "2026-11-23" })])
    assert.equal(
      cart.validateCart(state, catalogue(), menu),
      messages.DAILY_MENU_LINE_UNAVAILABLE,
    );
  // An option sold out, an addition switched off, a new category: choose again.
  for (const menu of [
    soldOut(),
    daily({ extras: [] }),
    contracts.toClientDailyMenu({
      cafeteria: ok.cafeteria,
      businessDate: DAY,
      title: "Almuerzo del día",
      price: "9500.00",
      categories: [
        single(2, "Proteína", ["Pollo"]),
        single(6, "Principio", ["Arroz"]),
      ],
    }),
  ])
    assert.equal(
      cart.validateCart(state, catalogue(), menu),
      messages.DAILY_MENU_LINE_CHANGED,
    );
  // The closed cafeteria still wins, as for products.
  assert.equal(
    cart.validateCart(state, catalogue(false), ok),
    cart.CLOSED_MESSAGE,
  );
  // A cart without a plate behaves as before, whatever the daily menu.
  const products = cart.addProduct(
    cart.emptyCart(),
    catalogue(),
    PRODUCT,
    1,
  ).cart;
  assert.equal(cart.validateCart(products, catalogue(), null), null);
});

test("the shown total adds the plate and its additions at published prices", () => {
  const products = cart.addProduct(
    cart.emptyCart(),
    catalogue(),
    PRODUCT,
    2,
  ).cart;
  const state = withPlate(products);
  assert.equal(cart.menuLineAmount(cart.menuLine(state), daily()), 11500);
  const lines = checkout.checkoutLines(state, catalogue());
  assert.deepEqual(
    lines.map(({ id: lineId }) => lineId),
    [PRODUCT],
  );
});

test("the order body carries the plate in the backend's format, never a price", () => {
  const state = withPlate(
    cart.addProduct(cart.emptyCart(), catalogue(), PRODUCT, 1).cart,
  );
  const request = checkout.buildOrderRequest(state, "", null);
  assert.deepEqual(request, {
    cafeteriaId: CAFETERIA,
    items: [{ productId: PRODUCT, quantity: 1 }],
    dailyMenu: {
      businessDate: DAY,
      choices: [
        { categoryId: id(2), optionId: id(200) },
        { categoryId: id(4), skip: true },
        { categoryId: id(5), skip: true },
      ],
      additionIds: [id(900)],
    },
  });
  assert.doesNotMatch(JSON.stringify(request), /price|total|9500/i);
  // Only a plate: no products.
  assert.deepEqual(checkout.buildOrderRequest(withPlate(), "", null).items, []);
  // Same body, same signature (and Idempotency-Key); another plate, another one.
  const again = checkout.buildOrderRequest(
    JSON.parse(JSON.stringify(state)),
    "",
    null,
  );
  assert.equal(
    checkout.orderSignature(again),
    checkout.orderSignature(request),
  );
  const changed = checkout.buildOrderRequest(
    withPlate(state, daily(), { ...choice, additionIds: [] }),
    "",
    null,
  );
  assert.notEqual(
    checkout.orderSignature(changed),
    checkout.orderSignature(request),
  );
  // reviewOrder refuses a plate that no longer matches.
  const review = checkout.reviewOrder(
    state,
    catalogue(),
    { note: "", pickupTime: "" },
    new Date("2026-11-22T15:00:00Z"),
    null,
  );
  assert.deepEqual(review, {
    ok: false,
    error: messages.DAILY_MENU_LINE_UNAVAILABLE,
  });
});

test("DAILY_MENU_* order errors mark the plate and keep the cart", () => {
  for (const code of [
    "DAILY_MENU_SELECTION_INVALID",
    "DAILY_MENU_ADDITION_UNAVAILABLE",
    "DAILY_MENU_DATE_CHANGED",
    "DAILY_MENU_NOT_PUBLISHED",
    "DAILY_MENU_DISABLED",
  ]) {
    const error = errors.describeOrderError(409, code);
    assert.equal(error.action, "dailyMenu", code);
    assert.equal(error.message, messages.BACKEND_ERROR_MESSAGES[code], code);
  }
});
