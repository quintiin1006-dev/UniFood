import "server-only";
import { serverApiUrl } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { isClient } from "@/features/auth/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, message: string, code?: string) =>
  Response.json(
    { message, ...(code ? { code } : {}) },
    { status, headers: { "Cache-Control": "no-store" } },
  );

/** GET /api/me/context: identity from the server session only, never the browser. */
export function forwardClientContext() {
  return forward("/api/me/context", null);
}

/** GET /api/me/menu?cafeteriaId=: only a well-formed cafeteria id reaches Spring. */
export function forwardClientMenu(request: Request) {
  return forwardClientMenuFor(
    new URL(request.url).searchParams.get("cafeteriaId"),
    request.headers.get("if-none-match"),
  );
}

/** The same forward for server components, which already know the cafeteria id. */
export function forwardClientMenuFor(
  cafeteriaId: string | null,
  ifNoneMatch: string | null = null,
) {
  if (!cafeteriaId || !UUID.test(cafeteriaId))
    return Promise.resolve(
      fail(400, "Selecciona una cafetería válida.", "INVALID_REQUEST"),
    );
  return forward(
    `/api/me/menu?cafeteriaId=${encodeURIComponent(cafeteriaId)}`,
    ifNoneMatch,
  );
}

async function forward(path: string, ifNoneMatch: string | null) {
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "Sesión no válida.", "UNAUTHORIZED");
  if (!isClient(auth.profile))
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

  if (upstream.status === 304)
    return new Response(null, { status: 304, headers: out });
  const json = (upstream.headers.get("content-type") || "").includes(
    "application/json",
  );
  // Spring's own safe errors pass through; anything unexpected becomes a generic 502.
  if (!json || (upstream.status >= 500 && upstream.status !== 503))
    return fail(
      502,
      "No pudimos cargar esta información. Inténtalo nuevamente.",
      "BACKEND_UNAVAILABLE",
    );
  out.set("Content-Type", "application/json");
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: out,
  });
}
