import type { Order } from "@/types/order";
import type { BackendOrder } from "@/features/orders/types/backendOrder";
import { mapBackendOrder } from "@/features/orders/utils/orderMapper";
import {
  calledOrderActionMessage,
  type CalledOrderAction,
} from "@/features/orders/calledOrderActions";
import {
  orderActionMessage,
  rejectionMessage,
} from "@/features/orders/orderActionMessages";

/** The `code` of Spring's ApiErrorResponse, or null for a body that is not JSON. */
async function readErrorCode(response: Response): Promise<unknown> {
  try {
    return ((await response.json()) as { code?: unknown } | null)?.code ?? null;
  } catch {
    return null;
  }
}

/** A fixed message with the status and code the board needs (W4). */
const actionError = (message: string, status: number, code: unknown) =>
  Object.assign(new Error(message), { status, code });

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
    // The status lets the board choose a fixed message and its next step (listingStatus.ts).
    throw Object.assign(
      new Error(
        await readErrorMessage(
          response,
          `Error al obtener pedidos: ${response.status}`,
        ),
      ),
      { status: response.status },
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

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw actionError(orderActionMessage(0, null), 0, null);
  }

  if (!response.ok) {
    const code = await readErrorCode(response);
    throw actionError(
      orderActionMessage(response.status, code),
      response.status,
      code,
    );
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

  let response: Response;
  try {
    response = await fetch(`/api/orders/${order.id}/reject`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw actionError(rejectionMessage(0, null), 0, null);
  }

  if (!response.ok) {
    const code = await readErrorCode(response);
    throw actionError(
      rejectionMessage(response.status, code),
      response.status,
      code,
    );
  }

  const updatedBackendOrder: BackendOrder = await response.json();
  return mapBackendOrder(updatedBackendOrder);
}
