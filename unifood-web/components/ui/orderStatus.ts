// One map for the order state chip, used by worker, admin and client (docs/ui-paneles.md,
// «Tokens»).

export type OrderStatusTone =
  | "pending"
  | "preparing"
  | "ready"
  | "called"
  | "delivered"
  | "rejected"
  | "notCollected"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatusTone, string> = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  called: "Llamado",
  delivered: "Entregado",
  rejected: "Rechazado",
  notCollected: "No recogido",
  cancelled: "Cancelado",
};

/**
 * Tone of an order from its status, in any of the spellings the app uses (worker «called»,
 * API «CALLED», history «NOT_COLLECTED»). A cancellation by the cafeteria is a rejection.
 */
export function orderStatusTone(
  status: string,
  cancellationSource?: string | null,
): OrderStatusTone {
  switch (status.toUpperCase()) {
    case "PENDING":
      return "pending";
    case "PREPARING":
      return "preparing";
    case "READY":
      return "ready";
    case "CALLED":
      return "called";
    case "DELIVERED":
      return "delivered";
    case "NOT_COLLECTED":
      return "notCollected";
    case "CANCELLED":
      return cancellationSource === "WORKER" ? "rejected" : "cancelled";
    default:
      return "cancelled";
  }
}
