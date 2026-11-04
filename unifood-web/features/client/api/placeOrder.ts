import type { ClientCart } from "../types";

export type PlacedOrder = { id: string; status: string; total: number };
export type PlaceOrderResult =
  | { ok: true; order: PlacedOrder }
  | { ok: false; error: string; stale?: boolean };

const FALLBACK_ERROR = "No se pudo enviar el pedido. Intenta de nuevo.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends only the client's choices. Prices and cafeteria are resolved by the backend. */
export async function placeOrder(
  cart: ClientCart,
  pickupAt: string,
): Promise<PlaceOrderResult> {
  try {
    const response = await fetch("/api/me/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pickupAt,
        items: cart.lines.map((line) => ({
          lunchId: line.mealId,
          quantity: line.quantity,
          note: line.notes,
        })),
      }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 201)
      return {
        ok: false,
        error:
          typeof body?.message === "string" ? body.message : FALLBACK_ERROR,
        stale: response.status === 409,
      };
    if (
      typeof body?.id !== "string" ||
      !UUID.test(body.id) ||
      typeof body.status !== "string" ||
      typeof body.total !== "number"
    )
      return { ok: false, error: FALLBACK_ERROR };
    return {
      ok: true,
      order: { id: body.id, status: body.status, total: body.total },
    };
  } catch {
    return { ok: false, error: FALLBACK_ERROR };
  }
}
