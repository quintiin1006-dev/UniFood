import { formatCop } from "@/lib/numberFormat";
export { formatBusinessDate } from "@/features/availability/presentation";
import type { HistoryOrder, HistoryStatus } from "./types";

// Pesos without decimals, the same format as the admin dashboard (I6). A historical snapshot
// with cents is rounded half up for display; the contract keeps the exact value.
export const formatHistoryPrice = (amount: number) => formatCop(amount) ?? "—";

const clock = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const formatHistoryTime = (instant: string) =>
  clock.format(new Date(instant));
const completedDate = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "short",
  day: "numeric",
});
export const formatHistoryDate = (instant: string) =>
  completedDate.format(new Date(instant));
export const HISTORY_LABELS: Record<HistoryStatus, string> = {
  DELIVERED: "Entregado",
  NOT_COLLECTED: "No recogido",
  CANCELLED: "Cancelado",
};

/**
 * Fixed Spanish text of how an order ended. A cancelled order says who ended it; a worker
 * rejection adds its reason as plain text. Older cancellations without a source stay
 * «Cancelado», and an older worker cancellation without a reason is «Cancelado por la cafetería».
 */
export function historyStatusText(
  order: Pick<
    HistoryOrder,
    "status" | "cancellationSource" | "rejectionReason"
  >,
): string {
  if (order.status !== "CANCELLED") return HISTORY_LABELS[order.status];
  switch (order.cancellationSource) {
    case "WORKER":
      return order.rejectionReason
        ? `Rechazado por la cafetería: ${order.rejectionReason}`
        : "Cancelado por la cafetería";
    case "CLIENT":
      return "Cancelado por el cliente";
    case "SYSTEM":
      return "Cerrado por el sistema";
    default:
      return HISTORY_LABELS.CANCELLED;
  }
}

const fullDate = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};
/** A business day as DD/MM/AAAA. */
export const formatDayDate = fullDate;
/** «01/11/2026 – 18/11/2026»: both ends always carry the full date. */
export function formatShortRange(start: string, end: string): string {
  return start === end
    ? fullDate(end)
    : `${fullDate(start)} – ${fullDate(end)}`;
}

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "short",
});

/** Orders grouped by their Bogotá day, in the order they came (newest first). */
export function groupHistoryByDay<T extends { completedAt: string }>(
  orders: T[],
): { key: string; label: string; orders: T[] }[] {
  const groups: { key: string; label: string; orders: T[] }[] = [];
  for (const order of orders) {
    const when = new Date(order.completedAt);
    const key = dayKey.format(when);
    const last = groups.at(-1);
    if (last && last.key === key) last.orders.push(order);
    else {
      const text = dayLabel.format(when);
      // «Miércoles, 14 de oct»: only the first letter is a capital.
      const label = text.charAt(0).toUpperCase() + text.slice(1);
      groups.push({ key, label, orders: [order] });
    }
  }
  return groups;
}
