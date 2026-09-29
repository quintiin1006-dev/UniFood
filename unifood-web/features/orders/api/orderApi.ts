import { CAFETERIA_ID } from "@/lib/config";
import type { Order } from "@/types/order";
import type { BackendOrder } from "@/features/orders/types/backendOrder";
import { mapBackendOrder } from "@/features/orders/utils/orderMapper";

function getActionEndpoint(
  order: Order
): string | null {
  switch (order.status) {
    case "pending":
      return `/api/orders/${order.id}/prepare`;

    case "preparing":
      return `/api/orders/${order.id}/ready`;

    case "ready":
      return `/api/orders/${order.id}/call`;

    case "called":
      return `/api/orders/${order.id}/deliver`;

    case "delivered":
      return null;

    default:
      return null;
  }
}

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const message = await response.text();

  try {
    const data = JSON.parse(message);
    return data.message || data.detail || fallback;
  } catch {
    return message.trim() || fallback;
  }
}

export async function getOrders(): Promise<Order[]> {
  const response = await fetch(
    `/api/orders?cafeteriaId=${encodeURIComponent(CAFETERIA_ID)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Error al obtener pedidos: ${response.status}`)
    );
  }

  const data: BackendOrder[] =
    await response.json();

  return data.map(mapBackendOrder);
}

export async function advanceOrder(
  order: Order
): Promise<Order> {
  const endpoint =
    getActionEndpoint(order);

  if (!endpoint) {
    return order;
  }

  const response = await fetch(
    endpoint,
    {
      method: "PATCH",
    }
  );

  if (!response.ok) {
    const message =
      await readErrorMessage(
        response,
        "No se pudo actualizar el pedido."
      );

    const error =
      new Error(message) as Error & {
        status?: number;
      };

    error.status = response.status;

    throw error;
  }

  const updatedBackendOrder:
    BackendOrder =
      await response.json();

  return mapBackendOrder(
    updatedBackendOrder
  );
}

export async function cancelOrder(
  order: Order
): Promise<Order> {
  if (order.status !== "pending") {
    throw new Error(
      "Solo un pedido pendiente puede cancelarse."
    );
  }

  const response = await fetch(
    `/api/orders/${order.id}/cancel`,
    {
      method: "PATCH",
    }
  );

  if (!response.ok) {
    const message =
      await readErrorMessage(
        response,
        "No se pudo cancelar el pedido."
      );

    const error =
      new Error(message) as Error & {
        status?: number;
      };

    error.status = response.status;

    throw error;
  }

  const updatedBackendOrder:
    BackendOrder =
      await response.json();

  return mapBackendOrder(
    updatedBackendOrder
  );
}
