import type { Order } from "@/types/order";
import type {
  BackendOrder,
  BackendOrderStatus,
} from "@/features/orders/types/backendOrder";

export function mapOrderStatus(
  status: BackendOrderStatus
): Order["status"] {
  switch (status) {
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

    case "CANCELLED":
      return "cancelled";

    case "NOT_COLLECTED":
      return "not_collected";

    default:
      throw new Error(`Estado de pedido desconocido: ${status}`);
  }
}

export function mapBackendOrder(
  backendOrder: BackendOrder
): Order {
  return {
    id: backendOrder.id,
    student: backendOrder.clientName,
    studentId: backendOrder.clientDocument ?? "",
    createdAt: backendOrder.createdAt,
    updatedAt: backendOrder.updatedAt,
    items: backendOrder.items.map((item) => ({
      id: item.id,
      name: item.lunchName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      beverageChoice:
        item.beverageChoice ?? undefined,
      note:
        item.note ?? undefined,
      subtotal: item.subtotal,
    })),
    total: backendOrder.total,
    status: mapOrderStatus(
      backendOrder.status
    ),
  };
}
