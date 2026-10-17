import type { HistoryItem, HistoryOrder, TodayWorkerHistory } from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const amount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
    date(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60 &&
    Number.isFinite(Date.parse(value))
  );
}

// Pick only the published DTO; one malformed entry invalidates the whole snapshot.
// Keep Spring's ordering and amounts, including legitimate empty historical orders.
export function parseWorkerHistory(value: unknown): TodayWorkerHistory | null {
  if (
    !record(value) ||
    !date(value.businessDate) ||
    !instant(value.nextBusinessDateAt) ||
    !Array.isArray(value.orders)
  )
    return null;
  const ids = new Set<string>();
  const orders: HistoryOrder[] = [];
  for (const entry of value.orders as unknown[]) {
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.id) ||
      ids.has(entry.id.toLowerCase()) ||
      typeof entry.reference !== "string" ||
      !/^Pedido · [0-9A-F]{8}$/.test(entry.reference) ||
      !(
        entry.clientName == null ||
        (typeof entry.clientName === "string" &&
          entry.clientName.trim().length > 0)
      ) ||
      typeof entry.status !== "string" ||
      !["DELIVERED", "NOT_COLLECTED", "CANCELLED"].includes(entry.status) ||
      !instant(entry.completedAt) ||
      !amount(entry.total) ||
      !Array.isArray(entry.items)
    )
      return null;
    ids.add(entry.id.toLowerCase());
    const items: HistoryItem[] = [];
    for (const item of entry.items as unknown[]) {
      if (
        !record(item) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        typeof item.quantity !== "number" ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        !amount(item.unitPrice) ||
        !amount(item.subtotal)
      )
        return null;
      items.push({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      });
    }
    orders.push({
      id: entry.id,
      reference: entry.reference,
      // Additive compatibility: older Spring snapshots have no customer display name.
      clientName:
        entry.clientName == null ? null : (entry.clientName as string),
      status: entry.status as HistoryOrder["status"],
      completedAt: entry.completedAt,
      total: entry.total,
      items,
    });
  }
  return {
    businessDate: value.businessDate,
    nextBusinessDateAt: value.nextBusinessDateAt,
    orders,
  };
}
