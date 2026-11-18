import { currency } from "../client/domain/catalog";
import { formatClockTime } from "../../lib/orderTime";
import type { ClientOrder, OrderStatus } from "./types";

export const formatTotal = (total: string) => currency.format(Number(total));

const DAY = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const formatOrderDate = (iso: string) => DAY.format(new Date(iso));

/** The step an active order is on, for the progress line. */
export type OrderStep = "sent" | "preparing" | "ready";
export const STEPS: { id: OrderStep; label: string }[] = [
  { id: "sent", label: "Enviado" },
  { id: "preparing", label: "En preparación" },
  { id: "ready", label: "Listo" },
];

/** null once the order is over (delivered, cancelled, rejected or not collected). */
export function stepOf(status: OrderStatus): OrderStep | null {
  if (status === "PENDING") return "sent";
  if (status === "PREPARING") return "preparing";
  if (status === "READY" || status === "CALLED") return "ready";
  return null;
}

/** Headline and one supporting line per state: what is happening and what to do next. */
export function statusLine(order: ClientOrder): {
  title: string;
  detail: string;
} {
  const place = order.cafeteria.name;
  switch (order.status) {
    case "PENDING":
      return {
        title: "Pedido enviado",
        detail: `${place} aún no empieza a prepararlo. Puedes cancelarlo mientras siga pendiente.`,
      };
    case "PREPARING":
      return {
        title: "Están preparando tu pedido",
        detail: "Te avisaremos aquí cuando esté listo para recoger.",
      };
    case "READY":
      return {
        title: "Tu pedido está listo",
        detail: `Pasa a recogerlo en ${place}. Pagas en efectivo en caja.`,
      };
    case "CALLED":
      return {
        title: "Te están llamando",
        detail:
          order.reminderCount > 0
            ? `Recordatorio ${order.reminderCount}: acércate a recoger tu pedido en ${place}.`
            : `Acércate a recoger tu pedido en ${place}.`,
      };
    case "DELIVERED":
      return {
        title: "Pedido entregado",
        detail: "Gracias por tu pedido. Lo encuentras en tu historial.",
      };
    case "NOT_COLLECTED":
      return {
        title: "No recogiste tu pedido",
        detail: "La cafetería lo marcó como no recogido. Ya puedes hacer otro.",
      };
    case "CANCELLED":
      if (order.cancellationSource === "WORKER")
        return {
          title: "La cafetería rechazó tu pedido",
          detail: order.rejectionReason
            ? `Motivo: ${order.rejectionReason}`
            : "La cafetería no pudo atenderlo. Ya puedes hacer otro.",
        };
      if (order.cancellationSource === "SYSTEM")
        return {
          title: "Pedido cerrado",
          detail: "Se cerró al terminar el día. Ya puedes hacer otro.",
        };
      return {
        title: "Cancelaste tu pedido",
        detail: "Ya puedes hacer otro cuando quieras.",
      };
  }
}

export const pickupLabel = (order: ClientOrder) =>
  order.requestedPickupAt
    ? `Recoger a las ${formatClockTime(order.requestedPickupAt)}`
    : null;
