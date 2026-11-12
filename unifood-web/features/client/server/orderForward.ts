import "server-only";
import { serverApiUrl } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { isClient, sameOrigin } from "@/features/auth/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// chk_orders_idempotency_key_format (020).
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_BODY_BYTES = 8192;

type OrderBody = {
  cafeteriaId: string;
  items: { productId: string; quantity: number }[];
  note?: string | null;
  requestedPickupAt?: string;
};

// An ISO-8601 instant is far shorter; Spring checks its format, offset and range.
const MAX_PICKUP_LENGTH = 64;

const fail = (status: number, message: string, code: string) =>
  Response.json(
    { status, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );

const invalid = () =>
  fail(400, "El pedido no es válido.", "INVALID_ORDER_REQUEST");

/**
 * POST /api/me/orders (B15). The session gives the identity and the bearer; the browser
 * only chooses a cafeteria, products, quantities, a note and an optional pickup time.
 * Limits, the pickup time's range, prices, totals and
 * availability are Spring's: anything else in the body is dropped, never forwarded.
 */
export async function forwardCreateOrder(request: Request) {
  if (!sameOrigin(request))
    return fail(403, "Solicitud no permitida.", "FORBIDDEN");
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "Sesión no válida.", "UNAUTHORIZED");
  if (
    !isClient(auth.profile) ||
    auth.profile.roles.some((role) => role !== "CLIENT")
  )
    return fail(403, "No tienes permisos de cliente.", "FORBIDDEN");

  const key = request.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY.test(key)) return invalid();
  const body = await readOrder(request);
  if (!body) return invalid();

  let upstream: Response;
  try {
    // The bearer comes from the verified session; a browser Authorization is never read.
    upstream = await fetch(`${serverApiUrl()}/api/me/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // The order may exist anyway: retrying with the same key returns it, never a second one.
    return fail(
      502,
      "No pudimos conectar con UniFood. Inténtalo nuevamente.",
      "BACKEND_UNAVAILABLE",
    );
  }

  const json = (upstream.headers.get("content-type") || "").includes(
    "application/json",
  );
  const known =
    upstream.status === 200 ||
    upstream.status === 201 ||
    (upstream.status >= 400 && upstream.status < 500) ||
    upstream.status === 503;
  // Spring's own answers pass through; anything unexpected becomes a generic 502.
  if (!json || !known)
    return fail(
      502,
      "No pudimos crear tu pedido en este momento. Inténtalo nuevamente.",
      "BACKEND_UNAVAILABLE",
    );
  const out = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) out.set("Retry-After", retryAfter);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: out,
  });
}

// Spring's opaque history cursor and its 1-50 page size (docs/decisiones.md §11).
const CURSOR = /^[A-Za-z0-9_-]{1,96}$/;
const LIMIT = /^[0-9]{1,2}$/;

/** GET /api/me/orders/current (B16): polled, so If-None-Match, ETag and 304 cross the BFF. */
export function forwardCurrentOrder(request: Request) {
  return forwardRead(
    "/api/me/orders/current",
    request.headers.get("if-none-match"),
  );
}

/** GET /api/me/orders (B16): only a well-formed cursor and limit reach Spring. */
export function forwardOrderHistory(request: Request) {
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") || "";
  const limit = params.get("limit") || "";
  if (
    (cursor && !CURSOR.test(cursor)) ||
    (limit && (!LIMIT.test(limit) || Number(limit) < 1 || Number(limit) > 50))
  )
    return Promise.resolve(invalid());
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit) query.set("limit", limit);
  const search = query.size ? `?${query}` : "";
  return forwardRead(`/api/me/orders${search}`, null);
}

/** GET /api/me/orders/{id} (B16): a malformed id names no order, the same 404 as Spring. */
export async function forwardOwnOrder(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await context.params;
  if (!UUID.test(orderId))
    return fail(404, "No encontramos ese pedido.", "ORDER_NOT_FOUND");
  return forwardRead(`/api/me/orders/${orderId.toLowerCase()}`, null);
}

async function forwardRead(path: string, ifNoneMatch: string | null) {
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "Sesión no válida.", "UNAUTHORIZED");
  if (
    !isClient(auth.profile) ||
    auth.profile.roles.some((role) => role !== "CLIENT")
  )
    return fail(403, "No tienes permisos de cliente.", "FORBIDDEN");

  // The bearer comes from the verified session; a browser Authorization is never read.
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    accept: "application/json",
  };
  if (ifNoneMatch && ifNoneMatch.length <= 512)
    headers["if-none-match"] = ifNoneMatch;

  let upstream: Response;
  try {
    upstream = await fetch(`${serverApiUrl()}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail(
      502,
      "No pudimos conectar con UniFood. Inténtalo nuevamente.",
      "BACKEND_UNAVAILABLE",
    );
  }

  // Only these headers cross the BFF; cookies and internal headers stay behind.
  const out = new Headers({
    "Cache-Control": upstream.headers.get("cache-control") || "no-store",
  });
  const etag = upstream.headers.get("etag");
  if (etag) out.set("ETag", etag);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) out.set("Retry-After", retryAfter);
  if (upstream.status === 304 && ifNoneMatch)
    return new Response(null, { status: 304, headers: out });

  const json = (upstream.headers.get("content-type") || "").includes(
    "application/json",
  );
  const known =
    upstream.status === 200 ||
    (upstream.status >= 400 && upstream.status < 500) ||
    upstream.status === 503;
  // Spring's own answers pass through; anything unexpected becomes a generic 502.
  if (!json || !known)
    return fail(
      502,
      "No pudimos cargar tus pedidos en este momento. Inténtalo nuevamente.",
      "BACKEND_UNAVAILABLE",
    );
  out.set("Content-Type", "application/json");
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: out,
  });
}

/** The body rebuilt from the allowed fields only, or null when its shape is wrong. */
async function readOrder(request: Request): Promise<OrderBody | null> {
  if (
    !(request.headers.get("content-type") || "")
      .toLowerCase()
      .startsWith("application/json")
  )
    return null;
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return null;
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { cafeteriaId, items, note, requestedPickupAt } = raw as Record<
    string,
    unknown
  >;
  if (typeof cafeteriaId !== "string" || !UUID.test(cafeteriaId)) return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  if (note !== undefined && note !== null && typeof note !== "string")
    return null;
  // Optional: absent or null is "as soon as possible"; a string goes to Spring as is.
  if (
    requestedPickupAt !== undefined &&
    requestedPickupAt !== null &&
    (typeof requestedPickupAt !== "string" ||
      requestedPickupAt.length > MAX_PICKUP_LENGTH)
  )
    return null;
  const lines: OrderBody["items"] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { productId, quantity } = item as Record<string, unknown>;
    if (typeof productId !== "string" || !UUID.test(productId)) return null;
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 1)
      return null;
    lines.push({ productId, quantity: quantity as number });
  }
  return {
    cafeteriaId,
    items: lines,
    ...(typeof note === "string" ? { note } : {}),
    ...(typeof requestedPickupAt === "string" ? { requestedPickupAt } : {}),
  };
}
