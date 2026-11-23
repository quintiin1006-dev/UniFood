import { readServiceFee } from "../../service-fee/presentation";
import {
  parsePlacedOrder,
  type OrderRequest,
  type PlacedOrder,
} from "../domain/checkout";
import {
  describeOrderError,
  NETWORK_ERROR,
  type CheckoutError,
} from "../errors";

export type PlaceOrderResult =
  | { ok: true; order: PlacedOrder; replay: boolean }
  | { ok: false; error: CheckoutError };

const TIMEOUT_MS = 20_000;

/**
 * POST /api/me/orders through the BFF. 201 is a new order; 200 is an idempotent repeat of the
 * same request and counts as success too. Failures become fixed messages: the backend text is
 * never read. A lost response is a network error and is safe to retry with the same key.
 */
export async function placeOrder(
  request: OrderRequest,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceOrderResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/me/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON answer is handled by its status below.
  }
  if (response.status === 200 || response.status === 201) {
    const order = parsePlacedOrder(body);
    // The order may exist even if its body is unreadable: the same key returns it again.
    return order
      ? { ok: true, order, replay: response.status === 200 }
      : { ok: false, error: NETWORK_ERROR };
  }
  const code =
    body && typeof body === "object"
      ? (body as { code?: unknown }).code
      : undefined;
  const error = describeOrderError(
    response.status,
    typeof code === "string" && code.length <= 64 ? code : undefined,
  );
  // The fee in force comes with the 409, so the new total shows before the menu is read again.
  if (error.action === "serviceFee" && body && typeof body === "object") {
    const fee = (body as { serviceFee?: unknown }).serviceFee;
    if (fee !== undefined && fee !== null)
      return {
        ok: false,
        error: { ...error, serviceFee: readServiceFee(fee) },
      };
  }
  return { ok: false, error };
}
