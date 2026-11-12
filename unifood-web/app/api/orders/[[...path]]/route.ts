import { getAuth } from "@/features/auth/server/session";
import { isWorker, sameOrigin } from "@/features/auth/validation";
import { serverApiUrl } from "@/config/server";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";

import { checkRejectionReason } from "@/features/orders/rejectionReason";

// The worker does not cancel; it rejects PENDING or PREPARING with a reason (decisiones §6).
// "remind" and "not-collected" act on CALLED orders and, like the rest except reject, send no body.
const actions = new Set([
  "prepare",
  "ready",
  "call",
  "remind",
  "deliver",
  "not-collected",
  "reject",
]);
const MAX_REJECT_BODY_BYTES = 2048;
const LISTING_UNAVAILABLE = "No se pudo resolver la cafetería de tu cuenta.";

/** Only `{reason}` crosses the BFF, already trimmed and within 3-200 characters. */
async function rejectBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  let reason: unknown = null;
  if (declared <= MAX_REJECT_BODY_BYTES) {
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length <= MAX_REJECT_BODY_BYTES) {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          reason = (parsed as Record<string, unknown>).reason;
      }
    } catch {
      reason = null;
    }
  }
  const check = checkRejectionReason(reason);
  if (!check.ok)
    return {
      error: Response.json(
        { status: 400, code: check.code, message: check.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  return { body: JSON.stringify({ reason: check.reason }) };
}

async function forward(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await context.params;
  const isList = request.method === "GET" && path.length === 0;
  const isAction =
    request.method === "PATCH" &&
    path.length === 2 &&
    /^[0-9a-f-]{36}$/i.test(path[0]) &&
    actions.has(path[1]);

  if (!isList && !isAction) {
    return Response.json(
      { message: "Ruta de pedidos no disponible." },
      { status: 404 },
    );
  }

  if (isAction && !sameOrigin(request)) {
    return Response.json({ message: "Origen no permitido." }, { status: 403 });
  }
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth)
    return Response.json(
      { message: "Inicia sesión para consultar los pedidos." },
      { status: 401 },
    );
  if (!isWorker(auth.profile))
    return Response.json(
      { message: "No tienes permisos de trabajador." },
      { status: 403 },
    );

  let body: string | undefined;
  if (isAction && path[1] === "reject") {
    const parsed = await rejectBody(request);
    if (parsed.error) return parsed.error;
    body = parsed.body;
  }

  const base = serverApiUrl();
  // The listing is one Spring call: it resolves the cafeteria from the database facts of that
  // same request, so no query parameter or earlier context ever selects it.
  const url = new URL(
    isList
      ? `${base}/api/worker/orders`
      : `${base}/api/orders/${path.join("/")}`,
  );

  try {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${auth.accessToken}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (
      isList &&
      (response.status !== 200 ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ))
    ) {
      // Same fixed message as the former context step; no upstream body is public.
      await response.body?.cancel().catch(() => {});
      return Response.json(
        { message: LISTING_UNAVAILABLE },
        {
          status: [401, 403].includes(response.status) ? response.status : 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...(isList && response.headers.get("x-business-date")
          ? { "X-Business-Date": response.headers.get("x-business-date")! }
          : {}),
        ...(isList && response.headers.get("x-next-business-date-at")
          ? {
              "X-Next-Business-Date-At": response.headers.get(
                "x-next-business-date-at",
              )!,
            }
          : {}),
      },
    });
  } catch {
    return Response.json(
      {
        message:
          "No se pudo conectar con el backend de pedidos. Revisa que esté disponible.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = forward;
export const PATCH = forward;
