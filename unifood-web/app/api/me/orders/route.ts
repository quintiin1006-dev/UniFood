import { getAuth } from "@/features/auth/server/session";
import { isClient, sameOrigin } from "@/features/auth/validation";
import { serverApiUrl } from "@/config/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Opaque here: the backend owns the identifier format and rejects anything malformed. */
const DISH_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_PLATES = 3;
const MAX_NOTE = 200;

/** Messages the backend deliberately writes for the client; any other upstream text stays private. */
const CLIENT_MESSAGE_STATUSES = new Set([400, 409]);

function failure(request: Request, status: number, message: string) {
  return Response.json(
    {
      status,
      message,
      path: new URL(request.url).pathname,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Keeps only the fields the backend accepts. Browser-supplied prices or identities are dropped. */
function sanitize(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const { items, pickupAt } = body as { items?: unknown; pickupAt?: unknown };
  if (typeof pickupAt !== "string" || Number.isNaN(Date.parse(pickupAt)))
    return null;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_PLATES)
    return null;
  const lines = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const { lunchId, quantity, note } = item as Record<string, unknown>;
    if (typeof lunchId !== "string" || !DISH_ID.test(lunchId)) return null;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_PLATES
    )
      return null;
    if (note !== undefined && note !== null && typeof note !== "string")
      return null;
    if (typeof note === "string" && note.length > MAX_NOTE) return null;
    lines.push({
      lunchId,
      quantity,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    });
  }
  return { pickupAt: new Date(pickupAt).toISOString(), items: lines };
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return failure(request, 403, "Origen no permitido.");
  const auth = await getAuth();
  if (!auth)
    return failure(request, 401, "Inicia sesión para enviar tu pedido.");
  if (
    !isClient(auth.profile) ||
    auth.profile.roles.some((role) => role !== "CLIENT")
  )
    return failure(request, 403, "Tu cuenta no puede enviar pedidos.");

  const payload = await request.json().catch(() => null);
  const body = sanitize(payload);
  if (!body)
    return failure(
      request,
      400,
      "Revisa los platos del pedido e intenta de nuevo.",
    );

  try {
    // Identity comes only from the verified session. Nothing else from the browser is forwarded.
    const response = await fetch(`${serverApiUrl()}/api/me/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });

    if (response.status === 201) {
      const order = await response.json();
      // Spring may serialize BigDecimal as a JSON number or as a decimal string.
      const total =
        typeof order?.total === "string" || typeof order?.total === "number"
          ? Number(order.total)
          : NaN;
      if (
        typeof order?.id !== "string" ||
        !UUID.test(order.id) ||
        typeof order?.status !== "string" ||
        !Number.isFinite(total)
      )
        return failure(request, 502, "No se pudo confirmar el pedido.");
      // Only the acknowledgement goes back to the browser, never the upstream order or session data.
      return Response.json(
        { id: order.id, status: order.status, total },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (CLIENT_MESSAGE_STATUSES.has(response.status)) {
      const upstream = await response.json().catch(() => null);
      if (typeof upstream?.message === "string")
        return failure(request, response.status, upstream.message);
      return failure(
        request,
        response.status,
        "Revisa tu pedido e intenta de nuevo.",
      );
    }
    if (response.status === 401)
      return failure(request, 401, "Inicia sesión para enviar tu pedido.");
    if (response.status === 403)
      return failure(request, 403, "Tu cuenta no puede enviar pedidos.");
    return failure(
      request,
      502,
      "No se pudo enviar el pedido. Intenta de nuevo.",
    );
  } catch {
    return failure(
      request,
      502,
      "No se pudo enviar el pedido. Intenta de nuevo.",
    );
  }
}
