import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const menuDomain = loadTs("features/client/domain/menu.ts");
const cart = loadTs("features/client/domain/cart.ts");
const checkout = loadTs("features/client/domain/checkout.ts");
const errors = loadTs("features/client/errors.ts");
const idempotency = loadTs("features/client/idempotency.ts");
const fixtures = loadTs("tests/fixtures/client-menu.ts");
const placeOrderModule = availabilityLoader()(
  "features/client/api/placeOrder.ts",
);
const { PRODUCT } = fixtures;
const central = menuDomain.toCafeteriaMenu(
  fixtures.clientMenus[fixtures.CAFETERIA_CENTRAL],
);
const filled = (...entries) =>
  entries.reduce((state, [productId, quantity]) => {
    const result = cart.addProduct(state, central, productId, quantity);
    assert.equal(result.error, undefined);
    return result.cart;
  }, cart.emptyCart());
const state = filled([PRODUCT.juice, 2], [PRODUCT.chicken, 1]);
// 2026-11-20 12:00 in Bogotá (UTC-05:00).
const noon = new Date("2026-11-20T12:00:00-05:00");
const input = (extra = {}) => ({
  note: "",
  pickupTime: "",
  accepted: true,
  ...extra,
});

test("a pickup time must be later than now and today in Bogotá, and goes out with its offset", () => {
  assert.equal(checkout.earliestPickup(noon), "12:01");
  assert.deepEqual(checkout.pickupInstant("12:01", noon), {
    ok: true,
    iso: "2026-11-20T12:01:00-05:00",
  });
  assert.equal(checkout.pickupInstant("23:59", noon).ok, true);
  for (const value of ["12:00", "11:59", "00:00", "", "1:30", "24:00", "12:60"])
    assert.equal(checkout.pickupInstant(value, noon).ok, false, value);
  // Seconds count: 12:00:30 is already past 12:00 but before 12:01.
  const seconds = new Date("2026-11-20T12:00:30-05:00");
  assert.equal(checkout.pickupInstant("12:00", seconds).ok, false);
  assert.equal(checkout.pickupInstant("12:01", seconds).ok, true);
  // "Today" is Bogotá's day, whatever the host timezone: 02:00Z is still the 19th there.
  const lateUtc = new Date("2026-11-20T02:00:00Z");
  assert.equal(checkout.bogotaDate(lateUtc), "2026-11-19");
  assert.equal(
    checkout.pickupInstant("22:00", lateUtc).iso,
    "2026-11-19T22:00:00-05:00",
  );
  // Nothing is left after 23:59.
  assert.equal(
    checkout.earliestPickup(new Date("2026-11-20T23:59:10-05:00")),
    null,
  );
  assert.match(checkout.pickupLabel("2026-11-20T15:30:00-05:00"), /3:30/);
});

test("the order body carries ids, quantities, one trimmed note and the optional time", () => {
  const plain = checkout.buildOrderRequest(state, "", null);
  assert.deepEqual(plain, {
    cafeteriaId: fixtures.CAFETERIA_CENTRAL,
    items: [
      { productId: PRODUCT.juice, quantity: 2 },
      { productId: PRODUCT.chicken, quantity: 1 },
    ],
  });
  assert.equal("note" in plain, false);
  assert.equal("requestedPickupAt" in plain, false);
  const full = checkout.buildOrderRequest(
    state,
    "  Sin cebolla  ",
    "2026-11-20T13:30:00-05:00",
  );
  assert.equal(full.note, "Sin cebolla");
  assert.equal(full.requestedPickupAt, "2026-11-20T13:30:00-05:00");
  // Prices, names, totals and per-line notes never travel.
  assert.deepEqual(Object.keys(full.items[0]).sort(), [
    "productId",
    "quantity",
  ]);
  assert.deepEqual(Object.keys(full).sort(), [
    "cafeteriaId",
    "items",
    "note",
    "requestedPickupAt",
  ]);
});

test("review applies the cart rules, the 200-character note, the pickup time and the terms", () => {
  const ok = checkout.reviewOrder(state, central, input(), noon);
  assert.equal(ok.ok, true);
  assert.equal("requestedPickupAt" in ok.request, false);
  const timed = checkout.reviewOrder(
    state,
    central,
    input({ pickupTime: "13:00" }),
    noon,
  );
  assert.equal(timed.request.requestedPickupAt, "2026-11-20T13:00:00-05:00");
  const past = checkout.reviewOrder(
    state,
    central,
    input({ pickupTime: "11:00" }),
    noon,
  );
  assert.equal(past.ok, false);
  assert.equal(past.field, "pickup");
  assert.equal(
    checkout.reviewOrder(state, central, input({ note: "a".repeat(200) }), noon)
      .ok,
    true,
  );
  const long = checkout.reviewOrder(
    state,
    central,
    input({ note: "a".repeat(201) }),
    noon,
  );
  assert.equal(long.field, "note");
  // Emoji count as one character, like length() in PostgreSQL.
  assert.equal(checkout.noteLength("😀".repeat(200)), 200);
  assert.equal(
    checkout.reviewOrder(state, central, input({ accepted: false }), noon)
      .field,
    "terms",
  );
  const closed = menuDomain.toCafeteriaMenu(
    fixtures.clientMenus[fixtures.CAFETERIA_BLOQUE_B],
  );
  assert.equal(checkout.reviewOrder(state, closed, input(), noon).ok, false);
  assert.equal(
    checkout.reviewOrder(cart.emptyCart(), central, input(), noon).ok,
    false,
  );
});

test("the checkout no longer has any service hours, slots or preview", () => {
  const catalog = loadTs("features/client/domain/catalog.ts");
  for (const name of [
    "pickupSlots",
    "reviewCheckout",
    "cartMealKind",
    "PREPARATION_MINUTES",
  ])
    assert.equal(name in checkout, false, name);
  for (const name of ["serviceHours", "serviceWindow", "colombiaTime"])
    assert.equal(name in catalog, false, name);
});

test("the Idempotency-Key follows the content: reused on retry, new when it changes", () => {
  let counter = 0;
  const generate = () => `key-${String(++counter).padStart(16, "0")}`;
  const request = checkout.buildOrderRequest(state, "Sin cebolla", null);
  const signature = checkout.orderSignature(request);
  const first = idempotency.nextAttempt(null, signature, generate);
  const retry = idempotency.nextAttempt(first, signature, generate);
  assert.equal(retry.key, first.key);
  assert.equal(counter, 1);
  // The same items in another order are the same request.
  const shuffled = {
    ...request,
    items: [...request.items].reverse(),
  };
  assert.equal(checkout.orderSignature(shuffled), signature);
  for (const changed of [
    checkout.buildOrderRequest(state, "Con cebolla", null),
    checkout.buildOrderRequest(
      state,
      "Sin cebolla",
      "2026-11-20T13:00:00-05:00",
    ),
    checkout.buildOrderRequest(filled([PRODUCT.juice, 3]), "Sin cebolla", null),
  ]) {
    const next = idempotency.nextAttempt(
      first,
      checkout.orderSignature(changed),
      generate,
    );
    assert.notEqual(next.key, first.key);
  }
  // A note with only spaces is the same request as no note.
  assert.equal(
    checkout.orderSignature(checkout.buildOrderRequest(state, "   ", null)),
    checkout.orderSignature(checkout.buildOrderRequest(state, "", null)),
  );
  assert.match(
    idempotency.nextAttempt(null, signature).key,
    /^[A-Za-z0-9_-]{16,128}$/,
  );
});

test("the attempt survives a reload for the same client and is cleared after a success", () => {
  const values = new Map();
  const store = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const attempt = { signature: "s", key: "0123456789abcdef0123" };
  idempotency.saveAttempt("client-1", attempt, store);
  assert.deepEqual(idempotency.readAttempt("client-1", store), attempt);
  assert.equal(idempotency.readAttempt("client-2", store), null);
  idempotency.clearAttempt(store);
  assert.equal(idempotency.readAttempt("client-1", store), null);
  values.set(idempotency.ATTEMPT_STORAGE_KEY, "not json");
  assert.equal(idempotency.readAttempt("client-1", store), null);
  values.set(
    idempotency.ATTEMPT_STORAGE_KEY,
    JSON.stringify({ ownerId: "client-1", signature: "s", key: "bad key!" }),
  );
  assert.equal(idempotency.readAttempt("client-1", store), null);
  assert.equal(idempotency.readAttempt("client-1", null), null);
});

const created = {
  id: "11111111-2222-3333-4444-555555555555",
  status: "PENDING",
  total: "24000.00",
  note: "Sin cebolla",
  createdAt: "2026-11-20T17:00:00Z",
  requestedPickupAt: "2026-11-20T18:30:00Z",
  cafeteria: { id: fixtures.CAFETERIA_CENTRAL, name: "Cafetería Central" },
  items: [
    {
      name: "Jugo natural",
      quantity: 2,
      unitPrice: "4500.00",
      subtotal: "9000.00",
    },
  ],
};
const request = checkout.buildOrderRequest(state, "Sin cebolla", null);
const respond =
  (status, body, headers = {}) =>
  async () =>
    Response.json(body, { status, headers });

test("the order client posts to the BFF with the key and counts 200 like 201", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return Response.json(created, { status: calls.length === 1 ? 201 : 200 });
  };
  const first = await placeOrderModule.placeOrder(
    request,
    "key-aaaaaaaaaaaaaaaa",
    fetchImpl,
  );
  assert.equal(first.ok, true);
  assert.equal(first.replay, false);
  assert.equal(first.order.total, 24000);
  assert.equal(first.order.cafeteria, "Cafetería Central");
  assert.deepEqual(first.order.items, [
    { name: "Jugo natural", quantity: 2, unitPrice: 4500 },
  ]);
  const second = await placeOrderModule.placeOrder(
    request,
    "key-aaaaaaaaaaaaaaaa",
    fetchImpl,
  );
  assert.equal(second.ok, true);
  assert.equal(second.replay, true);
  assert.equal(calls[0].url, "/api/me/orders");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[0].options.headers["idempotency-key"],
    "key-aaaaaaaaaaaaaaaa",
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].options.body), request);
  assert.equal(calls[0].options.headers.authorization, undefined);
});

test("a retry after a lost response reuses the key and gets the same order", async () => {
  const seen = [];
  let attempt = null;
  const orders = new Map();
  const fetchImpl = async (_url, options) => {
    const key = options.headers["idempotency-key"];
    seen.push(key);
    const replay = orders.has(key);
    orders.set(key, created);
    if (!replay)
      throw new TypeError("network lost after the order was created");
    return Response.json(created, { status: 200 });
  };
  const signature = checkout.orderSignature(request);
  attempt = idempotency.nextAttempt(
    null,
    signature,
    () => "stable-key-0123456789",
  );
  const lost = await placeOrderModule.placeOrder(
    request,
    attempt.key,
    fetchImpl,
  );
  assert.equal(lost.ok, false);
  assert.equal(lost.error.action, "retry");
  assert.equal(lost.error.newKey, false);
  // The user confirms again: nothing changed, so the key is the same.
  attempt = idempotency.nextAttempt(
    attempt,
    signature,
    () => "another-key-0123456789",
  );
  const retried = await placeOrderModule.placeOrder(
    request,
    attempt.key,
    fetchImpl,
  );
  assert.equal(retried.ok, true);
  assert.equal(retried.replay, true);
  assert.deepEqual(seen, ["stable-key-0123456789", "stable-key-0123456789"]);
  assert.equal(orders.size, 1);
});

test("every order error maps to a fixed Spanish message and an action", async () => {
  const cases = [
    [409, "CAFETERIA_CLOSED", "menu", /cerrada/],
    [409, "PRODUCT_UNAVAILABLE", "cart", /Actualiza tu carrito/],
    [409, "ACTIVE_ORDER_EXISTS", "home", /pedido en curso/],
    [409, "IDEMPOTENCY_KEY_CONFLICT", "retry", /cambió/],
    [400, "INVALID_PICKUP_TIME", "time", /hora de recogida/],
    [400, "ORDER_NOTE_TOO_LONG", "note", /200 caracteres/],
    [400, "ORDER_LIMIT_EXCEEDED", "cart", /10 unidades por producto y 15/],
    [400, "INVALID_ORDER_REQUEST", "cart", /No pudimos validar/],
    [404, "CAFETERIA_NOT_FOUND", "choose", /ya no está disponible/],
    [403, "CAFETERIA_NOT_SUBSCRIBED", "choose", /ya no está disponible/],
    [403, "FORBIDDEN", "home", /no puede crear pedidos/],
    [401, "UNAUTHORIZED", "login", /sesión terminó/],
    [503, "ORDER_TEMPORARILY_UNAVAILABLE", "retry", /carrito se conserva/],
    [502, "BACKEND_UNAVAILABLE", "retry", /carrito se conserva/],
    [503, "AUTH_TEMPORARILY_UNAVAILABLE", "retry", /carrito se conserva/],
    [418, "SOMETHING_NEW", "retry", /Inténtalo de nuevo/],
    [500, undefined, "retry", /Inténtalo de nuevo/],
  ];
  for (const [status, code, action, message] of cases) {
    const result = await placeOrderModule.placeOrder(
      request,
      "key-aaaaaaaaaaaaaaaa",
      respond(status, {
        status,
        code,
        message: "PRIVATE Spring detail: java.sql.SQLException",
        activeOrderId: "PRIVATE",
      }),
    );
    assert.equal(result.ok, false, `${status} ${code}`);
    assert.equal(result.error.action, action, `${status} ${code}`);
    assert.match(result.error.message, message, `${status} ${code}`);
    assert.doesNotMatch(
      JSON.stringify(result.error),
      /PRIVATE|Spring|SQL|java/,
      `${status} ${code}`,
    );
  }
  // 401/403 with no known code still get their own messages.
  assert.equal(errors.describeOrderError(401, undefined).action, "login");
  assert.equal(errors.describeOrderError(403, "OTHER").action, "home");
  // Only two errors invalidate the key: the content changed, or the request was rejected.
  assert.equal(
    errors.describeOrderError(409, "IDEMPOTENCY_KEY_CONFLICT").newKey,
    true,
  );
  assert.equal(
    errors.describeOrderError(409, "CAFETERIA_CLOSED").newKey,
    false,
  );
  assert.equal(errors.NETWORK_ERROR.newKey, false);
});

test("non-JSON answers, a bad success body and network failures are retryable errors", async () => {
  for (const fetchImpl of [
    async () => new Response("<html>PRIVATE</html>", { status: 502 }),
    async () => new Response("", { status: 200 }),
    respond(201, { id: "x" }),
    respond(200, { ...created, total: "abc" }),
    respond(200, { ...created, items: [{ name: "x" }] }),
    async () => {
      throw new TypeError("PRIVATE offline");
    },
  ]) {
    const result = await placeOrderModule.placeOrder(
      request,
      "key-aaaaaaaaaaaaaaaa",
      fetchImpl,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.action, "retry");
    assert.doesNotMatch(JSON.stringify(result.error), /PRIVATE/);
  }
});

test("a placed order is read defensively and optional fields may be absent", () => {
  const bare = checkout.parsePlacedOrder({
    id: "o1",
    status: "PENDING",
    total: 9000,
    items: [{ name: "Jugo", quantity: 1, unitPrice: 9000 }],
  });
  assert.equal(bare.note, null);
  assert.equal(bare.requestedPickupAt, null);
  assert.equal(bare.cafeteria, null);
  for (const payload of [
    null,
    [],
    "x",
    {},
    { ...created, id: "" },
    { ...created, items: "x" },
  ])
    assert.equal(checkout.parsePlacedOrder(payload), null);
  assert.equal(
    checkout.parsePlacedOrder({ ...created, requestedPickupAt: "not a date" })
      .requestedPickupAt,
    null,
  );
});
