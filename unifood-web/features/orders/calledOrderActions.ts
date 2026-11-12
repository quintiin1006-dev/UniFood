import type { Order } from "@/types/order";

/** Same rules as `Order.remindStudent` and `Order.markNotCollected` in Spring, which decides. */
export const MAX_REMINDERS = 3;
export const REMINDER_INTERVAL_MS = 5 * 60_000;

export type CalledOrderAction = "remind" | "not-collected";

export function reminderCount(order: Order): number {
  return order.reminderCount ?? 0;
}

/** When the next reminder is allowed, or null if there is none left or the order is not CALLED. */
export function nextReminderAt(order: Order): number | null {
  if (order.status !== "called" || reminderCount(order) >= MAX_REMINDERS)
    return null;
  const reference = Date.parse(order.lastRemindedAt ?? order.calledAt ?? "");
  return Number.isFinite(reference) ? reference + REMINDER_INTERVAL_MS : null;
}

export type ReminderAvailability =
  | { kind: "available" }
  | { kind: "wait"; minutes: number }
  | { kind: "limit" }
  | { kind: "unavailable" };

/**
 * A hint for the button only; the browser clock may drift, so Spring's answer is the one that
 * counts. Without `calledAt` the button stays usable and Spring decides.
 */
export function reminderAvailability(
  order: Order,
  now: number,
): ReminderAvailability {
  if (order.status !== "called") return { kind: "unavailable" };
  if (reminderCount(order) >= MAX_REMINDERS) return { kind: "limit" };
  const next = nextReminderAt(order);
  if (next === null || next <= now) return { kind: "available" };
  return {
    kind: "wait",
    minutes: Math.max(1, Math.ceil((next - now) / 60_000)),
  };
}

export function canMarkNotCollected(order: Order): boolean {
  return order.status === "called" && reminderCount(order) >= MAX_REMINDERS;
}

const STATE_CHANGED =
  "El pedido ya cambió de estado. Revisa el tablero actualizado.";

/** Fixed Spanish messages by code; Spring's text never reaches the worker. */
export function calledOrderActionMessage(
  action: CalledOrderAction,
  status: number,
  code: unknown,
): string {
  switch (code) {
    case "REMINDER_TOO_EARLY":
      return "Aún no puedes volver a avisar. Espera 5 minutos desde el último aviso.";
    case "REMINDER_LIMIT_REACHED":
      return "Ya enviaste los 3 avisos a este pedido. Puedes marcarlo como no recogido.";
    case "NOT_COLLECTED_REQUIREMENTS_NOT_MET":
      return "Para marcarlo como no recogido primero debes enviar los 3 avisos.";
    case "INVALID_ORDER_STATE":
    case "ORDER_CONCURRENT_MODIFICATION":
      return STATE_CHANGED;
  }
  if (status === 409) return STATE_CHANGED;
  if (status === 401) return "Tu sesión expiró. Inicia sesión de nuevo.";
  if (status === 403) return "No tienes permisos para gestionar este pedido.";
  return action === "remind"
    ? "No se pudo enviar el aviso. Inténtalo de nuevo."
    : "No se pudo marcar el pedido como no recogido. Inténtalo de nuevo.";
}
