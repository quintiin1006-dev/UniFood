import type { CafeteriaMenu, ClientCart } from "../types";
import { COLOMBIA_TIME_ZONE } from "./catalog";
import { cartItems, restoreCart, validateCart } from "./cart";

/** §6: one note per order, at most 200 characters. */
export const NOTE_LIMIT = 200;
// Colombia has no daylight saving time: Bogotá is always UTC-05:00.
const BOGOTA_OFFSET = "-05:00";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: COLOMBIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: COLOMBIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const pickupClock = new Intl.DateTimeFormat("es-CO", {
  timeZone: COLOMBIA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** Today's date in Bogotá, as YYYY-MM-DD. */
export const bogotaDate = (now: Date) => dayFormat.format(now);
const bogotaMinutes = (now: Date) => {
  const [hour, minute] = clockFormat.format(now).split(":").map(Number);
  return hour * 60 + minute;
};
const toClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The earliest HH:mm that is still later than now today (Bogotá), or null late at night. */
export function earliestPickup(now: Date): string | null {
  const next = bogotaMinutes(now) + 1;
  return next < 24 * 60 ? toClock(next) : null;
}

export const PICKUP_TIME_MESSAGE =
  "Elige una hora de hoy posterior a la actual, o envía el pedido lo antes posible.";

export type PickupResult =
  { ok: true; iso: string } | { ok: false; error: string };

/**
 * An optional pickup time typed as HH:mm (Bogotá). It must be later than now and belong to
 * today in Bogotá; the result is ISO-8601 with offset, as Spring expects. Spring validates
 * it again (INVALID_PICKUP_TIME).
 */
export function pickupInstant(value: string, now: Date): PickupResult {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    return { ok: false, error: PICKUP_TIME_MESSAGE };
  const iso = `${bogotaDate(now)}T${value}:00${BOGOTA_OFFSET}`;
  if (!(Date.parse(iso) > now.getTime()))
    return { ok: false, error: PICKUP_TIME_MESSAGE };
  return { ok: true, iso };
}

/** "3:30 p. m." for an ISO instant, in Bogotá time. */
export function pickupLabel(iso: string) {
  return pickupClock.format(new Date(iso));
}

export const noteLength = (note: string) => Array.from(note.trim()).length;

export type OrderRequest = {
  cafeteriaId: string;
  items: { productId: string; quantity: number }[];
  note?: string;
  requestedPickupAt?: string;
};

/** The body of POST /api/me/orders: ids, quantities, the note and the optional time only. */
export function buildOrderRequest(
  cart: ClientCart,
  note: string,
  requestedPickupAt: string | null,
): OrderRequest {
  const safe = restoreCart(cart);
  const trimmed = note.trim();
  return {
    cafeteriaId: safe.cafeteriaId ?? "",
    items: safe.lines.map(({ productId, quantity }) => ({
      productId,
      quantity,
    })),
    ...(trimmed ? { note: trimmed } : {}),
    ...(requestedPickupAt ? { requestedPickupAt } : {}),
  };
}

/** Same content, same signature: the Idempotency-Key follows it (docs/decisiones.md §6). */
export function orderSignature(request: OrderRequest) {
  return JSON.stringify([
    request.cafeteriaId,
    [...request.items]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map(({ productId, quantity }) => [productId, quantity]),
    request.note ?? null,
    request.requestedPickupAt ?? null,
  ]);
}

export type CheckoutLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};
export type CheckoutInput = {
  note: string;
  /** HH:mm, or empty for "lo antes posible". */
  pickupTime: string;
  accepted: boolean;
};
export type ReviewResult =
  | { ok: true; request: OrderRequest }
  | { ok: false; error: string; field?: "note" | "pickup" | "terms" };

/** Everything the browser can check before sending; Spring repeats it all. */
export function reviewOrder(
  cart: ClientCart,
  menu: CafeteriaMenu | null,
  input: CheckoutInput,
  now: Date,
): ReviewResult {
  const issue = validateCart(cart, menu);
  if (issue) return { ok: false, error: issue };
  if (noteLength(input.note) > NOTE_LIMIT)
    return {
      ok: false,
      error: `La nota admite hasta ${NOTE_LIMIT} caracteres.`,
      field: "note",
    };
  let pickup: string | null = null;
  if (input.pickupTime) {
    const result = pickupInstant(input.pickupTime, now);
    if (!result.ok) return { ...result, field: "pickup" };
    pickup = result.iso;
  }
  if (!input.accepted)
    return {
      ok: false,
      error: "Acepta las condiciones de recogida para continuar.",
      field: "terms",
    };
  return { ok: true, request: buildOrderRequest(cart, input.note, pickup) };
}

/** Lines for display, from the current menu. */
export function checkoutLines(
  cart: ClientCart,
  menu: CafeteriaMenu,
): CheckoutLine[] {
  return cartItems(cart, menu).map(({ line, product }) => ({
    id: line.productId,
    name: product?.name ?? "Producto que ya no está en el menú",
    quantity: line.quantity,
    unitPrice: product?.price ?? 0,
  }));
}

export type PlacedOrder = {
  id: string;
  status: string;
  total: number;
  note: string | null;
  requestedPickupAt: string | null;
  cafeteria: string | null;
  items: { name: string; quantity: number; unitPrice: number }[];
};

const money = (value: unknown) => {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

/** Reads the 200/201 body defensively; null when it is not an order. */
export function parsePlacedOrder(payload: unknown): PlacedOrder | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const body = payload as Record<string, unknown>;
  const total = money(body.total);
  if (
    typeof body.id !== "string" ||
    !body.id ||
    typeof body.status !== "string" ||
    total === null ||
    !Array.isArray(body.items)
  )
    return null;
  const items: PlacedOrder["items"] = [];
  for (const raw of body.items) {
    const item =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const unitPrice = money(item?.unitPrice);
    if (
      !item ||
      typeof item.name !== "string" ||
      !Number.isSafeInteger(item.quantity) ||
      unitPrice === null
    )
      return null;
    items.push({
      name: item.name,
      quantity: item.quantity as number,
      unitPrice,
    });
  }
  const cafeteria = body.cafeteria as { name?: unknown } | null | undefined;
  const pickup =
    typeof body.requestedPickupAt === "string" &&
    !Number.isNaN(Date.parse(body.requestedPickupAt))
      ? body.requestedPickupAt
      : null;
  return {
    id: body.id,
    status: body.status,
    total,
    note: typeof body.note === "string" && body.note ? body.note : null,
    requestedPickupAt: pickup,
    cafeteria: typeof cafeteria?.name === "string" ? cafeteria.name : null,
    items,
  };
}
