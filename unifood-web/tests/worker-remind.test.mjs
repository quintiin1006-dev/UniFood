import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const ORDER = "00000000-0000-0000-0000-000000000071";
const CALLED_AT = "2026-11-20T17:00:00.000Z";
const worker = {
  accessToken: "verified-worker-token",
  profile: { id: "worker", active: true, roles: ["WORKER"] },
};
const backendOrder = (overrides = {}) => ({
  id: ORDER,
  cafeteriaId: "00000000-0000-0000-0000-000000000002",
  clientId: null,
  clientName: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  status: "CALLED",
  total: 13000,
  createdAt: "2026-11-20T16:30:00Z",
  updatedAt: CALLED_AT,
  items: [],
  calledAt: CALLED_AT,
  reminderCount: 1,
  lastRemindedAt: "2026-11-20T17:05:00.000Z",
  ...overrides,
});
const order = (overrides = {}) => ({
  id: ORDER,
  student: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:30:00Z",
  updatedAt: CALLED_AT,
  items: [],
  status: "called",
  calledAt: CALLED_AT,
  reminderCount: 0,
  ...overrides,
});
const at = (seconds) => Date.parse(CALLED_AT) + seconds * 1000;

// ---------------------------------------------------------------- BFF

function route({ auth = worker, fetchMock } = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchMock) return fetchMock(url, options);
      return Response.json(backendOrder());
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return { calls, ...load("app/api/orders/[[...path]]/route.ts") };
}

function send(
  handler,
  action,
  { origin = "http://localhost:3100", method = "PATCH" } = {},
) {
  return handler(
    new Request(`http://localhost:3100/api/orders/${ORDER}/${action}`, {
      method,
      headers: {
        host: "localhost:3100",
        ...(origin ? { origin } : {}),
        authorization: "Bearer forged-by-browser",
      },
    }),
    { params: Promise.resolve({ path: [ORDER, action] }) },
  );
}

for (const action of ["remind", "not-collected"]) {
  test(`the BFF forwards ${action} with the session bearer and no body`, async () => {
    const { calls, PATCH } = route();
    const response = await send(PATCH, action);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    const [{ url, options }] = calls;
    assert.equal(url, `http://backend.test:8080/api/orders/${ORDER}/${action}`);
    assert.equal(options.method, "PATCH");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(
      options.headers.get("authorization"),
      "Bearer verified-worker-token",
    );
    assert.equal(options.body, undefined);
  });

  test(`${action}: origin, session and role are checked before Spring`, async () => {
    for (const [options, auth, status] of [
      [{ origin: "https://evil.example" }, worker, 403],
      [{ origin: null }, worker, 403],
      [{}, null, 401],
      [
        {},
        { ...worker, profile: { ...worker.profile, roles: ["CLIENT"] } },
        403,
      ],
      [
        {},
        { ...worker, profile: { ...worker.profile, roles: ["ADMIN"] } },
        403,
      ],
    ]) {
      const { calls, PATCH } = route({ auth });
      const response = await send(PATCH, action, options);
      assert.equal(response.status, status);
      assert.equal(calls.length, 0);
    }
  });

  test(`${action} only exists as PATCH`, async () => {
    const { calls, GET } = route();
    const response = await send(GET, action, { method: "GET" });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  });
}

test("Spring's 409 and 403 keep their status and code through the BFF", async () => {
  for (const [status, code] of [
    [409, "REMINDER_TOO_EARLY"],
    [409, "REMINDER_LIMIT_REACHED"],
    [409, "NOT_COLLECTED_REQUIREMENTS_NOT_MET"],
    [409, "INVALID_ORDER_STATE"],
    [403, "FORBIDDEN"],
  ]) {
    const { PATCH } = route({
      fetchMock: async () =>
        Response.json({ status, code, message: "Texto de Spring" }, { status }),
    });
    const response = await send(PATCH, "remind");
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

test("an unknown action is still a 404 that never reaches Spring", async () => {
  const { calls, PATCH } = route();
  assert.equal((await send(PATCH, "cancel")).status, 404);
  assert.equal((await send(PATCH, "notCollected")).status, 404);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- rules and messages

function rules() {
  return availabilityLoader()("features/orders/calledOrderActions.ts");
}

test("the reminder hint follows Spring: 5 minutes after the call or last reminder, 3 at most", () => {
  const { reminderAvailability, canMarkNotCollected } = rules();
  assert.deepEqual(reminderAvailability(order(), at(299)), {
    kind: "wait",
    minutes: 1,
  });
  assert.deepEqual(reminderAvailability(order(), at(60)), {
    kind: "wait",
    minutes: 4,
  });
  assert.deepEqual(reminderAvailability(order(), at(300)), {
    kind: "available",
  });
  const reminded = order({
    reminderCount: 1,
    lastRemindedAt: new Date(at(300)).toISOString(),
  });
  assert.equal(reminderAvailability(reminded, at(500)).kind, "wait");
  assert.equal(reminderAvailability(reminded, at(600)).kind, "available");
  assert.deepEqual(
    reminderAvailability(order({ reminderCount: 3 }), at(9999)),
    { kind: "limit" },
  );
  assert.deepEqual(reminderAvailability(order({ status: "ready" }), at(9999)), {
    kind: "unavailable",
  });
  // Without calledAt the browser does not guess; Spring decides.
  assert.deepEqual(
    reminderAvailability(order({ calledAt: undefined }), at(0)),
    {
      kind: "available",
    },
  );
  assert.equal(canMarkNotCollected(order({ reminderCount: 2 })), false);
  assert.equal(canMarkNotCollected(order({ reminderCount: 3 })), true);
  assert.equal(
    canMarkNotCollected(order({ reminderCount: 3, status: "delivered" })),
    false,
  );
});

test("each error has a fixed Spanish message and Spring's text never shows", async () => {
  const expected = {
    REMINDER_TOO_EARLY: /Espera 5 minutos/,
    REMINDER_LIMIT_REACHED: /Ya enviaste los 3 avisos/,
    NOT_COLLECTED_REQUIREMENTS_NOT_MET: /primero debes enviar los 3 avisos/,
    INVALID_ORDER_STATE: /ya cambió de estado/,
    ORDER_CONCURRENT_MODIFICATION: /ya cambió de estado/,
    FORBIDDEN: /No tienes permisos/,
  };
  for (const [code, message] of Object.entries(expected)) {
    const status = code === "FORBIDDEN" ? 403 : 409;
    const api = availabilityLoader({
      fetchMock: async () =>
        Response.json(
          { status, code, message: "SPRING_PRIVATE org.hibernate" },
          { status },
        ),
    })("features/orders/api/orderApi.ts");
    await assert.rejects(
      api.runCalledOrderAction(order(), "remind"),
      (error) => {
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /SPRING_PRIVATE|hibernate/);
        assert.equal(error.status, status);
        return true;
      },
    );
  }
  for (const fetchMock of [
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    async () => {
      throw new TypeError("fetch failed");
    },
  ]) {
    const api = availabilityLoader({ fetchMock })(
      "features/orders/api/orderApi.ts",
    );
    await assert.rejects(
      api.runCalledOrderAction(order(), "not-collected"),
      (error) => {
        assert.equal(
          error.message,
          "No se pudo marcar el pedido como no recogido. Inténtalo de nuevo.",
        );
        return true;
      },
    );
  }
});

test("a successful action returns the mapped order with its reminders", async () => {
  const calls = [];
  const api = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(backendOrder({ reminderCount: 2 }));
    },
  })("features/orders/api/orderApi.ts");
  const updated = await api.runCalledOrderAction(order(), "remind");
  assert.equal(calls[0].url, `/api/orders/${ORDER}/remind`);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(updated.reminderCount, 2);
  assert.equal(updated.calledAt, CALLED_AT);
  assert.equal(updated.lastRemindedAt, "2026-11-20T17:05:00.000Z");
  // An older backend without the fields maps to zero reminders, never undefined.
  const mapper = availabilityLoader()("features/orders/utils/orderMapper.ts");
  const legacy = backendOrder();
  delete legacy.reminderCount;
  assert.equal(mapper.mapBackendOrder(legacy).reminderCount, 0);
});

// ---------------------------------------------------------------- lock and refresh

function hook({ action }) {
  const listings = [];
  const actions = [];
  const effects = [];
  let start;
  const react = {
    useState(value) {
      let current = typeof value === "function" ? value() : value;
      return [
        current,
        (next) => {
          current = typeof next === "function" ? next(current) : next;
        },
      ];
    },
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  };
  const originalSetTimeout = global.setTimeout;
  const load = availabilityLoader({
    mocks: {
      react,
      "@/features/orders/api/orderApi": {
        getOperationalOrders: () => {
          listings.push(1);
          return Promise.resolve({
            orders: [order({ reminderCount: 3 })],
            nextBusinessDateAt: null,
          });
        },
        runCalledOrderAction: (current, kind) => {
          actions.push(kind);
          return action(current, kind);
        },
      },
    },
  });
  const originalSetInterval = global.setInterval;
  const hadWindow = "window" in global;
  global.setTimeout = (callback) => {
    start = callback;
    return 0;
  };
  global.setInterval = () => 0;
  if (!hadWindow)
    global.window = { addEventListener() {}, removeEventListener() {} };
  const hadDocument = "document" in global;
  if (!hadDocument)
    global.document = {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    };
  const exports = load("features/orders/hooks/useOrders.ts");
  const api = exports.useOrders(true);
  try {
    effects[0]();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    if (!hadWindow) delete global.window;
    if (!hadDocument) delete global.document;
  }
  return { api, listings, actions, start };
}

test("a double click sends one action and the board refreshes when it ends", async () => {
  let finish;
  const app = hook({
    action: () => new Promise((resolve) => (finish = resolve)),
  });
  app.start();
  await new Promise(setImmediate);
  assert.equal(app.listings.length, 1);
  const first = app.api.handleCalledOrderAction(
    order({ reminderCount: 3 }),
    "not-collected",
  );
  const second = await app.api.handleCalledOrderAction(
    order({ reminderCount: 3 }),
    "not-collected",
  );
  const remind = await app.api.handleCalledOrderAction(
    order({ reminderCount: 3 }),
    "remind",
  );
  assert.equal(second, null);
  assert.equal(remind, null);
  assert.deepEqual(app.actions, ["not-collected"]);
  finish(order({ status: "not_collected", reminderCount: 3 }));
  assert.equal((await first).status, "not_collected");
  await new Promise(setImmediate);
  assert.equal(app.listings.length, 2);
});

test("a failed action releases the lock and refreshes too", async () => {
  const app = hook({
    action: () =>
      Promise.reject(new Error("Ya enviaste los 3 avisos a este pedido.")),
  });
  app.start();
  await new Promise(setImmediate);
  assert.equal(await app.api.handleCalledOrderAction(order(), "remind"), null);
  await new Promise(setImmediate);
  assert.equal(app.listings.length, 2);
  await app.api.handleCalledOrderAction(order(), "remind");
  assert.deepEqual(app.actions, ["remind", "remind"]);
});

// ---------------------------------------------------------------- UI

function components() {
  return availabilityLoader()(
    "features/orders/components/CalledOrderActions.tsx",
  );
}
const html = (type, props) =>
  renderToStaticMarkup(React.createElement(type, props));

test("the bell shows the count and is disabled while busy, too early or at the limit", () => {
  const { RemindButton } = components();
  const props = { onRemind() {}, now: at(600) };
  const ready = html(RemindButton, {
    ...props,
    order: order({ reminderCount: 1 }),
  });
  assert.match(ready, /1\/3/);
  assert.match(
    ready,
    /aria-label="Avisar nuevamente a Ana Torres, 1 de 3 avisos enviados"/,
  );
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(
    html(RemindButton, { ...props, order: order(), busy: true }),
    /disabled=""/,
  );
  const early = html(RemindButton, { ...props, now: at(120), order: order() });
  assert.match(early, /disabled=""/);
  assert.match(early, /title="Podrás volver a avisar en 3 min"/);
  const limit = html(RemindButton, {
    ...props,
    order: order({ reminderCount: 3 }),
  });
  assert.match(limit, /disabled=""/);
  assert.match(limit, /Ya enviaste los 3 avisos/);
  const sending = html(RemindButton, {
    ...props,
    order: order(),
    busy: true,
    sending: true,
  });
  assert.match(sending, /aria-busy="true"/);
  assert.match(sending, /Enviando aviso a Ana Torres/);
  assert.equal(
    html(RemindButton, { ...props, order: order({ status: "ready" }) }),
    "",
  );
});

test("No recogido needs the 3 reminders and asks for a second click", () => {
  const { NotCollectedButton } = components();
  const before = html(NotCollectedButton, {
    order: order({ reminderCount: 2 }),
    onConfirm() {},
  });
  assert.match(before, />No recogido</);
  assert.match(before, /disabled=""/);
  assert.match(before, /Disponible después de enviar los 3 avisos/);
  const ready = html(NotCollectedButton, {
    order: order({ reminderCount: 3 }),
    onConfirm() {},
  });
  assert.match(ready, />No recogido</);
  assert.doesNotMatch(ready, /disabled=""/);
  const asking = html(NotCollectedButton, {
    order: order({ reminderCount: 3 }),
    onConfirm() {},
    initialConfirming: true,
  });
  assert.match(asking, />Confirmar no recogido</);
  assert.match(asking, /confirming/);
  // Busy hides the confirmation and blocks the button.
  const busy = html(NotCollectedButton, {
    order: order({ reminderCount: 3 }),
    onConfirm() {},
    initialConfirming: true,
    busy: true,
    sending: true,
  });
  assert.match(busy, /disabled=""/);
  assert.match(busy, />Registrando…</);
  assert.equal(
    html(NotCollectedButton, {
      order: order({ status: "delivered" }),
      onConfirm() {},
    }),
    "",
  );
  assert.equal(components().NOT_COLLECTED_CONFIRM_MS, 5000);
});

test("the confirmation transition respects prefers-reduced-motion", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(
    "features/orders/components/CalledOrderActions.module.css",
    "utf8",
  );
  const [outside, inside = ""] = css.split(
    "@media (prefers-reduced-motion: no-preference)",
  );
  assert.doesNotMatch(outside, /transition/);
  assert.match(inside, /transition/);
});
