import { HISTORY_LABELS } from "./presentation";
import type { HistoryOrder } from "./types";

export function normalizeHistoryQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

/** Local filtering only: preserve backend ordering, scope, dates and snapshots. */
export function filterHistoryOrders(
  orders: readonly HistoryOrder[],
  query: string,
): readonly HistoryOrder[] {
  const normalized = normalizeHistoryQuery(query);
  if (!normalized) return orders;
  return orders.filter((order) =>
    normalizeHistoryQuery(
      `${order.reference} ${order.status} ${HISTORY_LABELS[order.status]} ${order.clientName ?? ""}`,
    ).includes(normalized),
  );
}
