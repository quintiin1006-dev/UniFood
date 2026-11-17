// Local stand-in for the client's order reads and cancellation (docs/decisiones.md §11, B16) used
// by browser tests only. One state per client: the active order (or none) and a history of
// finished orders. A test drives it through POST /__test/client-flow.
//   GET   /api/me/orders/current   200 order | 200 null, ETag, 304 with If-None-Match
//   GET   /api/me/orders           {orders, nextCursor}, 20 per page, newest first
//   GET   /api/me/orders/{id}      the order, active or finished
//   PATCH /api/me/orders/{id}/cancel   PENDING only
const ACTIVE = new Set(["PENDING", "PREPARING", "READY", "CALLED"]);
const CAFETERIA = {
  id: "00000000-0000-4000-8000-000000000031",
  name: "Cafetería Central",
};
const CURRENT_ID = "00000000-0000-0000-0000-0000000000a1";
const json = (status, body, extra = {}) => ({
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, private",
    ...extra,
  },
  body: JSON.stringify(body),
});

const historyId = (n) =>
  `00000000-0000-0000-0001-${n.toString(16).padStart(12, "0")}`;

function build(id, status, extra = {}) {
  return {
    id,
    status,
    total: "13500.00",
    note: null,
    createdAt: "2026-11-20T17:00:00Z",
    items: [
      {
        name: "Almuerzo del día",
        quantity: 1,
        unitPrice: "9000.00",
        subtotal: "9000.00",
      },
      {
        name: "Jugo natural",
        quantity: 1,
        unitPrice: "4500.00",
        subtotal: "4500.00",
      },
    ],
    cafeteria: CAFETERIA,
    cancellationSource: null,
    rejectionReason: null,
    updatedAt: "2026-11-20T17:00:00Z",
    calledAt: null,
    reminderCount: 0,
    lastRemindedAt: null,
    deliveredAt: null,
    notCollectedAt: null,
    cancelledAt: null,
    requestedPickupAt: null,
    ...extra,
  };
}

export function createClientFlowFixture() {
  const states = new Map();
  const state = (clientId) => {
    if (!states.has(clientId))
      states.set(clientId, {
        order: null,
        version: 1,
        historyCount: 0,
        failCurrent: false,
        finished: new Map(),
      });
    return states.get(clientId);
  };

  return {
    /** POST /__test/client-flow: any field present changes that part of the state. */
    configure(clientId, config) {
      if (config.reset) states.delete(clientId);
      const own = state(clientId);
      if (typeof config.historyCount === "number")
        own.historyCount = config.historyCount;
      if (typeof config.failCurrent === "boolean")
        own.failCurrent = config.failCurrent;
      if (config.order === null) own.order = null;
      else if (typeof config.order === "string")
        own.order = build(CURRENT_ID, config.order, config.fields);
      else if (own.order && (config.status || config.fields))
        own.order = {
          ...own.order,
          ...(config.status ? { status: config.status } : {}),
          ...(config.fields ?? {}),
        };
      // A finished order is no longer "current" but stays readable by its id.
      if (own.order && !ACTIVE.has(own.order.status))
        own.finished.set(own.order.id, own.order);
      own.version += 1;
    },

    /** The stand-in's answer for this client, or null when the path is not one of its own. */
    handle(clientId, method, url, headers) {
      const own = state(clientId);
      const { pathname } = url;
      if (method === "GET" && pathname === "/api/me/orders/current") {
        if (own.failCurrent) return json(503, { code: "FORBIDDEN" });
        const active =
          own.order && ACTIVE.has(own.order.status) ? own.order : null;
        const tag = `"${active?.id ?? "none"}-${active?.status ?? ""}-${own.version}"`;
        if (headers["if-none-match"] === tag)
          return {
            status: 304,
            headers: { ETag: tag, "Cache-Control": "no-cache, private" },
            body: "",
          };
        return json(200, active, { ETag: tag });
      }
      if (method === "GET" && pathname === "/api/me/orders") {
        const offset = Number(
          (url.searchParams.get("cursor") ?? "c0").slice(1),
        );
        const limit = Number(url.searchParams.get("limit") ?? 20);
        if (!Number.isSafeInteger(offset) || offset < 0)
          return json(400, { code: "INVALID_ORDER_REQUEST" });
        const orders = [];
        for (
          let n = offset;
          n < Math.min(offset + limit, own.historyCount);
          n++
        )
          orders.push({
            id: historyId(n),
            status: n % 5 === 4 ? "NOT_COLLECTED" : "DELIVERED",
            total: "13500.00",
            createdAt: new Date(
              Date.parse("2026-11-19T17:00:00Z") - n * 86_400_000,
            ).toISOString(),
            cafeteriaName: CAFETERIA.name,
            itemCount: 2,
            summary: `1× Almuerzo del día, 1× Jugo natural (${n + 1})`,
          });
        const end = offset + limit;
        return json(200, {
          orders,
          nextCursor: end < own.historyCount ? `c${end}` : null,
        });
      }
      const match = pathname.match(
        /^\/api\/me\/orders\/([0-9a-f-]{36})(\/cancel)?$/,
      );
      if (!match) return null;
      const [, id, cancel] = match;
      const found =
        own.order?.id === id
          ? own.order
          : (own.finished.get(id) ??
            (id.startsWith("00000000-0000-0000-0001-")
              ? build(id, "DELIVERED", {
                  deliveredAt: "2026-11-19T17:20:00Z",
                })
              : null));
      if (!found) return json(404, { code: "ORDER_NOT_FOUND" });
      if (method === "GET" && !cancel) return json(200, found);
      if (method === "PATCH" && cancel) {
        if (found.status === "PREPARING")
          return json(409, { code: "ORDER_ALREADY_PREPARING" });
        if (found.status !== "PENDING")
          return json(409, { code: "INVALID_ORDER_STATE" });
        const cancelled = {
          ...found,
          status: "CANCELLED",
          cancellationSource: "CLIENT",
          cancelledAt: "2026-11-20T17:05:00Z",
        };
        own.order = cancelled;
        own.finished.set(id, cancelled);
        own.version += 1;
        return json(200, cancelled);
      }
      return null;
    },
  };
}
