import type { HistoryItem, HistoryOrder, WorkerHistoryPage } from "./types";

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
function nanos(value: string): bigint {
  return (
    BigInt(Date.parse(value.slice(0, 19) + "Z")) * BigInt(1000000) +
    BigInt((value.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(9, "0"))
  );
}

// Pick only the published DTO; one malformed entry invalidates the whole snapshot.
// Keep Spring's ordering and amounts, including legitimate empty historical orders.
export function parseWorkerHistory(value: unknown): WorkerHistoryPage | null {
  if (
    !record(value) ||
    !date(value.businessDate) ||
    !instant(value.nextBusinessDateAt) ||
    !date(value.monthStart) ||
    value.monthStart !== `${value.businessDate.slice(0, 7)}-01` ||
    !date(value.rangeStart) ||
    !date(value.rangeEnd) ||
    value.rangeStart < value.monthStart ||
    value.rangeStart > value.businessDate ||
    value.rangeEnd <= value.rangeStart ||
    Date.parse(value.rangeEnd + "T05:00:00Z") !==
      Date.parse(value.nextBusinessDateAt) ||
    Date.parse(value.nextBusinessDateAt) !==
      Date.parse(value.businessDate + "T05:00:00Z") + 86400000 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        /^[A-Za-z0-9_-]{1,512}$/.test(value.nextCursor))
    ) ||
    typeof value.hasHistory !== "boolean" ||
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
      !(entry.clientName == null || typeof entry.clientName === "string") ||
      typeof entry.status !== "string" ||
      !["DELIVERED", "NOT_COLLECTED", "CANCELLED"].includes(entry.status) ||
      !instant(entry.completedAt) ||
      Date.parse(entry.completedAt) <
        Date.parse(value.rangeStart + "T05:00:00Z") ||
      Date.parse(entry.completedAt) >= Date.parse(value.nextBusinessDateAt) ||
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
        entry.clientName == null || !(entry.clientName as string).trim()
          ? null
          : (entry.clientName as string),
      status: entry.status as HistoryOrder["status"],
      completedAt: entry.completedAt,
      total: entry.total,
      items,
    });
  }
  if (
    orders.length > 100 ||
    (!orders.length && value.nextCursor) ||
    (orders.length && !value.hasHistory)
  )
    return null;
  for (let i = 1; i < orders.length; i++) {
    const a = orders[i - 1],
      b = orders[i];
    if (
      nanos(a.completedAt) < nanos(b.completedAt) ||
      (nanos(a.completedAt) === nanos(b.completedAt) &&
        a.id.toLowerCase() <= b.id.toLowerCase())
    )
      return null;
  }
  return {
    businessDate: value.businessDate,
    nextBusinessDateAt: value.nextBusinessDateAt,
    monthStart: value.monthStart,
    rangeStart: value.rangeStart,
    rangeEnd: value.rangeEnd,
    nextCursor: value.nextCursor as string | null,
    hasHistory: value.hasHistory,
    orders,
  };
}
