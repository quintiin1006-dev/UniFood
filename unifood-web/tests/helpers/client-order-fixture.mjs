// Local stand-in for POST /api/me/orders (docs/decisiones.md §11) used by browser tests only.
// It applies the contract's checks in Spring's order and keeps idempotent orders per client.
// A note beginning with "__" triggers a failure on purpose:
//   __error:CODE      answers that error and creates nothing
//   __fail-once       answers 503 the first time a key is used, then creates the order
//   __lose-response   creates the order but drops the connection; the same key then replays it
import { createHash, randomUUID } from "node:crypto";

const STATUS = {
  FORBIDDEN: 403,
  CAFETERIA_NOT_SUBSCRIBED: 403,
  CAFETERIA_NOT_FOUND: 404,
  INVALID_ORDER_REQUEST: 400,
  ORDER_LIMIT_EXCEEDED: 400,
  ORDER_NOTE_TOO_LONG: 400,
  INVALID_PICKUP_TIME: 400,
  CAFETERIA_CLOSED: 409,
  PRODUCT_UNAVAILABLE: 409,
  ACTIVE_ORDER_EXISTS: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  ORDER_TEMPORARILY_UNAVAILABLE: 503,
};
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const bogotaDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
});

const fail = (code) => ({
  status: STATUS[code],
  body: {
    status: STATUS[code],
    code,
    message: `PRIVATE_SPRING_${code}`,
    ...(code === "ACTIVE_ORDER_EXISTS"
      ? { activeOrderId: "00000000-0000-0000-0000-00000000aaaa" }
      : {}),
  },
});

export function createClientOrderFixture(menuFor) {
  const orders = new Map();
  const seen = new Set();
  return function create({ clientId, key, body }) {
    if (!KEY.test(key ?? "")) return fail("INVALID_ORDER_REQUEST");
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!body?.cafeteriaId || !items.length)
      return fail("INVALID_ORDER_REQUEST");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          body.cafeteriaId,
          [...items].sort((a, b) => a.productId.localeCompare(b.productId)),
          note,
          body.requestedPickupAt
            ? new Date(body.requestedPickupAt).getTime()
            : null,
        ]),
      )
      .digest("hex");
    const stored = orders.get(`${clientId}:${key}`);
    if (stored)
      return stored.hash === hash
        ? { status: 200, body: stored.order }
        : fail("IDEMPOTENCY_KEY_CONFLICT");

    const trigger = /^__(error:([A-Z_]+)|fail-once|lose-response)$/.exec(note);
    if (trigger?.[2] && trigger[2] in STATUS) return fail(trigger[2]);
    if (note === "__fail-once" && !seen.has(`${clientId}:${key}`)) {
      seen.add(`${clientId}:${key}`);
      return fail("ORDER_TEMPORARILY_UNAVAILABLE");
    }

    if ([...note].length > 200) return fail("ORDER_NOTE_TOO_LONG");
    const menu = menuFor(body.cafeteriaId);
    if (menu.status !== 200) return fail("CAFETERIA_NOT_FOUND");
    const products = new Map(
      menu.body.categories.flatMap((category) =>
        category.products.map((product) => [product.id, product]),
      ),
    );
    const units = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    if (items.some((item) => item.quantity > 10) || units > 15)
      return fail("ORDER_LIMIT_EXCEEDED");
    if (body.requestedPickupAt !== undefined) {
      const at = Date.parse(body.requestedPickupAt);
      const offset = /(Z|[+-]\d{2}:\d{2})$/.test(body.requestedPickupAt);
      const now = new Date();
      if (
        !offset ||
        Number.isNaN(at) ||
        at <= now.getTime() ||
        bogotaDay.format(at) !== bogotaDay.format(now)
      )
        return fail("INVALID_PICKUP_TIME");
    }
    if (!menu.body.cafeteria.open) return fail("CAFETERIA_CLOSED");
    const lines = [];
    for (const item of items) {
      const product = products.get(item.productId);
      if (!product || !product.available) return fail("PRODUCT_UNAVAILABLE");
      const unitPrice = Number(product.price);
      lines.push({
        name: product.name,
        quantity: item.quantity,
        unitPrice: unitPrice.toFixed(2),
        subtotal: (unitPrice * item.quantity).toFixed(2),
      });
    }
    const order = {
      id: randomUUID(),
      status: "PENDING",
      total: lines
        .reduce((sum, line) => sum + Number(line.subtotal), 0)
        .toFixed(2),
      note: note || null,
      createdAt: new Date().toISOString(),
      requestedPickupAt: body.requestedPickupAt ?? null,
      cafeteria: {
        id: menu.body.cafeteria.id,
        name: menu.body.cafeteria.name,
      },
      items: lines,
    };
    orders.set(`${clientId}:${key}`, { hash, order });
    return note === "__lose-response"
      ? { status: 201, body: order, drop: true }
      : { status: 201, body: order };
  };
}
