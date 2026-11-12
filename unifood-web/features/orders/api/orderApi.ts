import type { Order } from "@/types/order";
import type { BackendOrder } from "@/features/orders/types/backendOrder";
import { mapBackendOrder } from "@/features/orders/utils/orderMapper";
import {
  calledOrderActionMessage,
  type CalledOrderAction,
} from "@/features/orders/calledOrderActions";

function getActionEndpoint(order: Order): string | null {
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
  fallback: string,
): Promise<string> {
  const message = await response.text();

  try {
    const data = JSON.parse(message);
    return data.message || data.detail || fallback;
  } catch {
    return message.trim() || fallback;
  }
}

export async function getOperationalOrders(): Promise<{
  orders: Order[];
  nextBusinessDateAt: string | null;
}> {
  const response = await fetch("/api/orders", {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Error al obtener pedidos: ${response.status}`,
      ),
    );
  }

  const data: BackendOrder[] = await response.json();

  const nextBusinessDateAt = response.headers.get("x-next-business-date-at");
  if (
    nextBusinessDateAt !== null &&
    !Number.isFinite(Date.parse(nextBusinessDateAt))
  )
    throw new Error("La fecha de negocio no es válida.");
  return { orders: data.map(mapBackendOrder), nextBusinessDateAt };
}

export async function getOrders(): Promise<Order[]> {
  return (await getOperationalOrders()).orders;
}

export async function advanceOrder(order: Order): Promise<Order> {
  const endpoint = getActionEndpoint(order);

  if (!endpoint) {
    return order;
  }

  const response = await fetch(endpoint, {
    method: "PATCH",
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      "No se pudo actualizar el pedido.",
    );

    const error = new Error(message) as Error & {
      status?: number;
    };

    error.status = response.status;

    throw error;
  }

  const updatedBackendOrder: BackendOrder = await response.json();

  return mapBackendOrder(updatedBackendOrder);
}

/** Reminder or manual "no recogido" of a CALLED order, with fixed messages per error code. */
export async function runCalledOrderAction(
  order: Order,
  action: CalledOrderAction,
): Promise<Order> {
  let response: Response;
  try {
    response = await fetch(`/api/orders/${order.id}/${action}`, {
      method: "PATCH",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw Object.assign(new Error(calledOrderActionMessage(action, 0, null)), {
      status: 0,
    });
  }

  if (!response.ok) {
    let code: unknown = null;
    try {
      code = ((await response.json()) as { code?: unknown } | null)?.code;
    } catch {
      code = null;
    }
    throw Object.assign(
      new Error(calledOrderActionMessage(action, response.status, code)),
      { status: response.status, code },
    );
  }

  return mapBackendOrder((await response.json()) as BackendOrder);
}

/** B18: PENDING or PREPARING only; the client will see the reason. */
export async function rejectOrder(
  order: Order,
  reason: string,
): Promise<Order> {
  if (order.status !== "pending" && order.status !== "preparing")
    throw new Error(
      "Solo un pedido pendiente o en preparación puede rechazarse.",
    );

  const response = await fetch(`/api/orders/${order.id}/reject`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      "No se pudo rechazar el pedido.",
    );
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const updatedBackendOrder: BackendOrder = await response.json();
  return mapBackendOrder(updatedBackendOrder);
}
