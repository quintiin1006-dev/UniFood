import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const cache = new Map();
function load(file) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => load(path.resolve(path.dirname(filename), `${name}.ts`)),
    mod,
    mod.exports,
  );
  cache.set(filename, mod.exports);
  return mod.exports;
}
const catalog = load("features/client/domain/catalog.ts");
const fixtures = load("features/client/mocks/catalog.ts");
const cart = load("features/client/domain/cart.ts");
const checkout = load("features/client/domain/checkout.ts");
const breakfast = new Date("2026-10-07T07:00:00-05:00");
const lunch = new Date("2026-10-07T12:00:00-05:00");
const add = (
  state,
  id,
  quantity = 1,
  notes = "",
  now = breakfast,
  site = "principal",
) =>
  cart.addMeal(
    state,
    site,
    id,
    quantity,
    notes,
    now,
    `line-${state.lines.length}`,
  );

test("Colombia service windows include opening and exclude closing regardless of host timezone", () => {
  for (const [kind, clock, expected] of [
    ["breakfast", "05:59", false],
    ["breakfast", "06:00", true],
    ["breakfast", "08:29", true],
    ["breakfast", "08:30", false],
    ["lunch", "11:29", false],
    ["lunch", "11:30", true],
    ["lunch", "14:29", true],
    ["lunch", "14:30", false],
  ]) {
    assert.equal(
      catalog.serviceAvailability(
        kind,
        "principal",
        new Date(`2026-10-07T${clock}:00-05:00`),
      ).open,
      expected,
      `${kind} ${clock}`,
    );
  }
  assert.equal(
    catalog.serviceAvailability("breakfast", "aguas-claras", breakfast).open,
    false,
  );
  assert.equal(catalog.colombiaTime(new Date("2026-10-08T02:00:00Z")).day, 3);
});
test("site catalog and carousel use own stock, meal types, days and prices", () => {
  const principal = fixtures.getSiteMeals(fixtures.findDemoSite("principal"));
  const aguas = fixtures.getSiteMeals(fixtures.findDemoSite("aguas-claras"));
  assert.equal(principal.filter((meal) => meal.kind === "breakfast").length, 5);
  assert.ok(aguas.every((meal) => meal.kind === "lunch"));
  assert.notEqual(
    principal.find((meal) => meal.id === "chicken").price,
    aguas.find((meal) => meal.id === "chicken").price,
  );
  const slides = catalog.featuredMeals(principal, lunch);
  assert.equal(slides.length, 5);
  assert.equal(slides.filter((meal) => meal.kind === "lunch").length, 3);
  assert.ok(slides.every((meal) => meal.stock > 0));
  assert.equal(
    catalog.featuredMeals(principal, breakfast)[0].kind,
    "breakfast",
  );
  const weekdayMeal = principal.find((meal) => meal.id === "executive-beef");
  assert.equal(
    catalog.mealAvailability(
      weekdayMeal,
      "principal",
      new Date("2026-10-11T12:00:00-05:00"),
    ).open,
    false,
  );
});

test("out-of-hours preview is opt-in and accepted only in development", () => {
  const originalEnv = process.env.NODE_ENV;
  const night = new Date("2026-10-07T22:00:00-05:00");
  try {
    for (const environment of ["development", "production", "test"]) {
      process.env.NODE_ENV = environment;
      for (const [kind, mealId] of [
        ["breakfast", "breakfast-eggs"],
        ["lunch", "chicken"],
      ]) {
        assert.equal(
          catalog.serviceAvailability(kind, "principal", night).open,
          false,
        );
        assert.equal(
          catalog.serviceAvailability(kind, "principal", night, true).open,
          environment === "development",
        );
        const result = cart.addMeal(
          cart.emptyCart(),
          "principal",
          mealId,
          1,
          "",
          night,
          "preview",
          true,
        );
        assert.equal(!result.error, environment === "development");
      }
    }
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});

test("development preview keeps campus, stock, menu-day and cart limits", () => {
  const originalEnv = process.env.NODE_ENV;
  const night = new Date("2026-10-07T22:00:00-05:00");
  try {
    process.env.NODE_ENV = "development";
    assert.equal(
      catalog.serviceAvailability("breakfast", "aguas-claras", night, true)
        .open,
      false,
    );
    const previewAdd = (
      mealId,
      quantity,
      now = night,
      state = cart.emptyCart(),
    ) =>
      cart.addMeal(
        state,
        "principal",
        mealId,
        quantity,
        "",
        now,
        "preview",
        true,
      );
    assert.match(previewAdd("special-fish", 1).error, /Agotado/);
    assert.match(
      previewAdd("executive-beef", 1, new Date("2026-10-11T22:00:00-05:00"))
        .error,
      /hoy/,
    );
    assert.match(previewAdd("breakfast-complete", 3).error, /unidades/);
    const full = previewAdd("chicken", 3).cart;
    assert.equal(cart.cartCount(full), 3);
    assert.match(previewAdd("beef", 1, night, full).error, /3 platos/);
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});
test("cart counts whole combos, aggregates identical notes and caps all quantities at three", () => {
  let result = add(cart.emptyCart(), "breakfast-eggs", 2, "  Sin cubiertos  ");
  assert.equal(result.error, undefined);
  assert.equal(cart.cartCount(result.cart), 2);
  result = add(result.cart, "breakfast-eggs", 1, "Sin cubiertos");
  assert.equal(result.cart.lines.length, 1);
  assert.equal(result.cart.lines[0].quantity, 3);
  const rejected = add(result.cart, "breakfast-broth");
  assert.match(rejected.error, /3 platos/);
  assert.deepEqual(rejected.cart, result.cart);
});
test("add rejects stock exhaustion across different notes, invalid quantity, long notes and closed menus", () => {
  const two = add(cart.emptyCart(), "breakfast-complete", 2).cart;
  assert.match(
    add(two, "breakfast-complete", 1, "Otra observación").error,
    /unidades/,
  );
  for (const quantity of [0, -1, 1.5, Infinity, NaN, 4])
    assert.ok(add(cart.emptyCart(), "breakfast-eggs", quantity).error);
  assert.ok(add(cart.emptyCart(), "breakfast-eggs", 1, "a".repeat(201)).error);
  assert.ok(add(cart.emptyCart(), "breakfast-eggs", 1, "", lunch).error);
  assert.ok(add(cart.emptyCart(), "special-fish", 1, "", lunch).error);
  assert.ok(
    add(cart.emptyCart(), "breakfast-eggs", 1, "", breakfast, "aguas-claras")
      .error,
  );
  const first = add(cart.emptyCart(), "chicken", 1, "", lunch).cart;
  assert.match(
    add(first, "beef", 1, "", lunch, "aguas-claras").error,
    /cafetería/,
  );
});
test("cart editing preserves totals, merges identical notes and never exceeds three combos", () => {
  let state = add(cart.emptyCart(), "chicken", 1, "Sin cubiertos", lunch).cart;
  state = add(state, "chicken", 1, "Otra nota", lunch).cart;
  const updated = cart.updateMeal(
    state,
    state.lines[1].id,
    { notes: "  Sin cubiertos  " },
    lunch,
  );
  assert.equal(updated.error, undefined);
  assert.equal(updated.cart.lines.length, 1);
  assert.equal(updated.cart.lines[0].quantity, 2);
  assert.equal(
    state.lines[0].quantity,
    1,
    "editing must not mutate the previous cart",
  );
  const id = updated.cart.lines[0].id;
  const full = cart.updateMeal(updated.cart, id, { quantity: 3 }, lunch).cart;
  assert.equal(cart.cartCount(full), 3);
  assert.match(
    cart.updateMeal(full, id, { quantity: 4 }, lunch).error,
    /3 platos/,
  );
  assert.ok(cart.updateMeal(full, id, { quantity: 0 }, lunch).error);
  assert.ok(cart.updateMeal(full, id, { quantity: 1.5 }, lunch).error);
  assert.ok(cart.updateMeal(full, id, { notes: "a".repeat(201) }, lunch).error);
  assert.match(
    cart.updateMeal(full, "removed", { notes: "x" }, lunch).error,
    /ya no/,
  );
});

test("stale cart lines can be reduced but increasing and checkout recheck stock and service hours", () => {
  const state = add(cart.emptyCart(), "breakfast-complete", 2).cart;
  const id = state.lines[0].id;
  assert.match(
    cart.updateMeal(state, id, { quantity: 3 }, breakfast).error,
    /unidades/,
  );
  const reduced = cart.updateMeal(state, id, { quantity: 1 }, lunch);
  assert.equal(reduced.error, undefined);
  assert.equal(reduced.cart.lines[0].quantity, 1);
  assert.match(
    cart.updateMeal(reduced.cart, id, { quantity: 2 }, lunch).error,
    /Disponible de/,
  );
  assert.match(cart.validateCart(reduced.cart, lunch), /Disponible de/);
  const excessiveStock = {
    ...state,
    lines: [
      ...state.lines,
      { ...state.lines[0], id: "other", quantity: 1, notes: "Otra nota" },
    ],
  };
  assert.match(
    cart.validateCart(excessiveStock, breakfast),
    /quedan 2 unidades/,
  );
});

test("pickup slots stay within today's Colombia service with exact twenty-minute and thirty-minute boundaries", () => {
  const lunchCart = add(cart.emptyCart(), "chicken", 1, "", lunch).cart;
  for (const [clock, expected] of [
    ["11:30:00", "12:00:00"],
    ["12:10:00", "12:30:00"],
    ["12:10:00.001", "13:00:00"],
    ["14:10:00", "14:30:00"],
    ["14:10:00.001", null],
  ]) {
    const now = new Date(`2026-10-07T${clock}-05:00`);
    const slots = checkout.pickupSlots(lunchCart, now);
    assert.equal(slots.length, 7);
    assert.equal(
      slots.find((slot) => slot.available)?.value ?? null,
      expected ? new Date(`2026-10-07T${expected}-05:00`).toISOString() : null,
    );
  }
  const breakfastCart = add(cart.emptyCart(), "breakfast-eggs").cart;
  const lastBreakfast = checkout
    .pickupSlots(breakfastCart, new Date("2026-10-07T08:10:00-05:00"))
    .filter((slot) => slot.available);
  assert.deepEqual(
    lastBreakfast.map((slot) => slot.value),
    ["2026-10-07T13:30:00.000Z"],
  );
  const lateUtc = checkout.pickupSlots(
    lunchCart,
    new Date("2026-10-08T02:00:00Z"),
  );
  assert.ok(
    lateUtc.every(
      (slot) => slot.value.startsWith("2026-10-07") && !slot.available,
    ),
  );
});

test("checkout requires acceptance and a currently valid slot and snapshots catalog prices", () => {
  const state = add(
    cart.emptyCart(),
    "chicken",
    2,
    "Sin cubiertos",
    lunch,
  ).cart;
  const slot = "2026-10-07T17:30:00.000Z";
  assert.equal(checkout.reviewCheckout(state, slot, false, lunch).ok, false);
  for (const invalid of [
    "",
    "invalid-date",
    "2026-10-07T17:15:00.000Z",
    "2026-10-08T17:30:00.000Z",
  ])
    assert.equal(
      checkout.reviewCheckout(state, invalid, true, lunch).ok,
      false,
    );
  const tampered = {
    ...state,
    lines: state.lines.map((line) => ({
      ...line,
      price: 1,
      name: "Forged name",
    })),
  };
  const result = checkout.reviewCheckout(tampered, slot, true, lunch);
  assert.equal(result.ok, true);
  assert.equal(result.summary.total, 30000);
  assert.equal(result.summary.lines[0].name, "Pechuga a la plancha");
  assert.equal(result.summary.lines[0].notes, "Sin cubiertos");
  assert.equal(result.summary.payment, "CASH_ON_PICKUP");
  assert.equal(
    state.lines[0].quantity,
    2,
    "review does not clear the cart or create an order",
  );
  assert.equal(
    checkout.reviewCheckout(
      state,
      slot,
      true,
      new Date("2026-10-07T12:10:01-05:00"),
    ).ok,
    false,
  );
  assert.equal(
    checkout.reviewCheckout(cart.emptyCart(), slot, true, lunch).ok,
    false,
  );
});

test("checkout preview uses the next lunch service only in development and keeps the twenty-minute margin", () => {
  const originalEnv = process.env.NODE_ENV;
  const state = add(cart.emptyCart(), "chicken", 1, "", lunch).cart;
  const now = new Date("2026-10-07T23:50:00-05:00");
  try {
    process.env.NODE_ENV = "development";
    const slots = checkout.pickupSlots(state, now, true);
    assert.equal(slots.length, 7);
    assert.equal(slots[0].value, "2026-10-08T16:30:00.000Z");
    assert.ok(
      slots.every(
        (slot) => new Date(slot.value).getTime() >= now.getTime() + 20 * 60000,
      ),
    );
    assert.equal(
      checkout.reviewCheckout(state, slots[0].value, true, now, true).ok,
      true,
    );
    process.env.NODE_ENV = "production";
    assert.equal(
      checkout.reviewCheckout(state, slots[0].value, true, now, true).ok,
      false,
    );
    assert.ok(
      checkout.pickupSlots(state, now, true).every((slot) => !slot.available),
    );
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});

test("breakfast and lunch always retain separate pickup windows even in after-hours preview", () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    for (const [mealId, kind, opening, closing, length] of [
      ["breakfast-eggs", "breakfast", 360, 510, 6],
      ["chicken", "lunch", 690, 870, 7],
    ]) {
      const state = add(
        cart.emptyCart(),
        mealId,
        1,
        "",
        kind === "breakfast" ? breakfast : lunch,
      ).cart;
      for (const clock of [
        "01:40",
        "02:00",
        "05:40",
        "06:00",
        "07:00",
        "08:11",
        "12:00",
        "14:11",
        "22:00",
        "23:50",
      ]) {
        const now = new Date(`2026-10-07T${clock}:00-05:00`);
        for (const preview of [false, true]) {
          const slots = checkout.pickupSlots(state, now, preview);
          assert.equal(slots.length, length);
          assert.equal(
            catalog.colombiaTime(new Date(slots[0].value)).minutes,
            opening,
          );
          assert.equal(
            catalog.colombiaTime(new Date(slots.at(-1).value)).minutes,
            closing,
          );
          for (const slot of slots) {
            const date = new Date(slot.value);
            const minutes = catalog.colombiaTime(date).minutes;
            assert.ok(
              minutes >= opening && minutes <= closing && minutes % 30 === 0,
            );
            if (slot.available)
              assert.ok(date.getTime() >= now.getTime() + 20 * 60_000);
          }
          if (preview) assert.ok(slots.some((slot) => slot.available));
        }
      }
    }
    const weekdayCart = add(
      cart.emptyCart(),
      "executive-beef",
      1,
      "",
      lunch,
    ).cart;
    assert.equal(
      checkout.pickupSlots(
        weekdayCart,
        new Date("2026-10-09T22:00:00-05:00"),
        true,
      )[0].value,
      "2026-10-12T16:30:00.000Z",
    );
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});

test("mixed meals are rejected on add and checkout, while legacy carts remain editable", () => {
  const originalEnv = process.env.NODE_ENV;
  const morning = add(cart.emptyCart(), "breakfast-eggs").cart;
  const afternoon = add(cart.emptyCart(), "chicken", 1, "", lunch).cart;
  try {
    process.env.NODE_ENV = "development";
    for (const [state, other] of [
      [morning, "chicken"],
      [afternoon, "breakfast-eggs"],
    ]) {
      const result = cart.addMeal(
        state,
        "principal",
        other,
        1,
        "",
        lunch,
        "other",
        true,
      );
      assert.match(result.error, /por separado/);
      assert.deepEqual(result.cart, state);
    }
    const mixed = {
      siteId: "principal",
      lines: [morning.lines[0], { ...afternoon.lines[0], id: "lunch" }],
    };
    assert.equal(
      cart.restoreCart(mixed).lines.length,
      2,
      "do not silently discard the user's existing cart",
    );
    assert.match(cart.validateCart(mixed, lunch, true), /por separado/);
    assert.equal(checkout.pickupSlots(mixed, lunch, true).length, 0);
    assert.equal(
      checkout.reviewCheckout(
        mixed,
        "2026-10-07T17:30:00.000Z",
        true,
        lunch,
        true,
      ).ok,
      false,
    );
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});

test("restored carts reject corrupt or excessive data and never trust stored prices", () => {
  const valid = add(cart.emptyCart(), "breakfast-eggs", 2).cart;
  assert.deepEqual(cart.restoreCart(valid), valid);
  const poisoned = {
    ...valid,
    lines: [{ ...valid.lines[0], price: 1, owner: "other" }],
  };
  assert.deepEqual(cart.restoreCart(poisoned), valid);
  for (const bad of [
    null,
    [],
    { siteId: "fake", lines: valid.lines },
    { ...valid, lines: [{ ...valid.lines[0], quantity: 99 }] },
    { ...valid, lines: [valid.lines[0], valid.lines[0]] },
    { ...valid, lines: [{ ...valid.lines[0], mealId: "missing" }] },
    { ...valid, lines: [null] },
  ])
    assert.deepEqual(cart.restoreCart(bad), cart.emptyCart());
});
