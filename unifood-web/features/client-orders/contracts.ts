import type {
  ClientOrder,
  OrderHistoryItem,
  OrderHistoryPage,
  OrderLine,
  OrderStatus,
} from "./types";

const STATUSES: readonly string[] = [
  "PENDING",
  "PREPARING",
  "READY",
  "CALLED",
  "DELIVERED",
  "CANCELLED",
  "NOT_COLLECTED",
];
const SOURCES = ["CLIENT", "WORKER", "SYSTEM"] as const;
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const status = (value: unknown): value is OrderStatus =>
  typeof value === "string" && STATUSES.includes(value);
const amount = (value: unknown): value is string =>
  typeof value === "string" && AMOUNT.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

function line(raw: unknown): OrderLine | null {
  const item = record(raw);
  if (!item || !text(item.name)) return null;
  if (!Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1)
    return null;
  if (!amount(item.unitPrice) || !amount(item.subtotal)) return null;
  return {
    name: item.name,
    quantity: item.quantity as number,
    unitPrice: item.unitPrice,
    subtotal: item.subtotal,
  };
}

/** The order of Spring, or null when its shape is not the contract: nothing is guessed. */
export function toClientOrder(raw: unknown): ClientOrder | null {
  const order = record(raw);
  if (!order) return null;
  const cafeteria = record(order.cafeteria);
  if (
    !text(order.id) ||
    !UUID.test(order.id) ||
    !status(order.status) ||
    !amount(order.total) ||
    !instant(order.createdAt) ||
    !cafeteria ||
    !text(cafeteria.id) ||
    !text(cafeteria.name) ||
    !Array.isArray(order.items)
  )
    return null;
  const items: OrderLine[] = [];
  for (const entry of order.items) {
    const parsed = line(entry);
    if (!parsed) return null;
    items.push(parsed);
  }
  const source = SOURCES.find((value) => value === order.cancellationSource);
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    note: text(order.note) ? order.note : null,
    createdAt: order.createdAt,
    items,
    cafeteria: { id: cafeteria.id, name: cafeteria.name },
    cancellationSource: source ?? null,
    rejectionReason: text(order.rejectionReason) ? order.rejectionReason : null,
    reminderCount:
      Number.isSafeInteger(order.reminderCount) &&
      (order.reminderCount as number) > 0
        ? (order.reminderCount as number)
        : 0,
    requestedPickupAt: instant(order.requestedPickupAt)
      ? order.requestedPickupAt
      : null,
  };
}

function historyItem(raw: unknown): OrderHistoryItem | null {
  const item = record(raw);
  if (
    !item ||
    !text(item.id) ||
    !UUID.test(item.id) ||
    !status(item.status) ||
    !amount(item.total) ||
    !instant(item.createdAt) ||
    !text(item.cafeteriaName) ||
    !Number.isSafeInteger(item.itemCount) ||
    typeof item.summary !== "string"
  )
    return null;
  return {
    id: item.id,
    status: item.status,
    total: item.total,
    createdAt: item.createdAt,
    cafeteriaName: item.cafeteriaName,
    itemCount: item.itemCount as number,
    summary: item.summary,
  };
}

/** `{orders, nextCursor}` of GET /api/me/orders, or null when the shape is wrong. */
export function toHistoryPage(raw: unknown): OrderHistoryPage | null {
  const page = record(raw);
  if (!page || !Array.isArray(page.orders)) return null;
  if (page.nextCursor !== null && !text(page.nextCursor)) return null;
  const orders: OrderHistoryItem[] = [];
  for (const entry of page.orders) {
    const parsed = historyItem(entry);
    if (!parsed) return null;
    orders.push(parsed);
  }
  return { orders, nextCursor: page.nextCursor as string | null };
}
