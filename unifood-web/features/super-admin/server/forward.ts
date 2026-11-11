import "server-only";
import { getAuth } from "@/features/auth/server/session";
import { isSuperAdmin, sameOrigin } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { SUPER_ADMIN_MESSAGES, superAdminErrorCode } from "../errors";

type Transport<T> = {
  path: "/api/super-admin/cafeterias";
  parse: (value: unknown) => T | null;
};

function failure(status: number, retry?: string | null) {
  const code = superAdminErrorCode(status);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry && /^\d{1,3}$/.test(retry) && Number(retry) <= 300 ? retry : "5";
  return Response.json(
    { status, code, message: SUPER_ADMIN_MESSAGES[code] },
    { status, headers },
  );
}

/**
 * Shared transport for /api/super-admin/**: same origin for any mutation, verified session,
 * SUPER_ADMIN admission and the session's Bearer. Spring decides again from the database.
 */
export async function forwardSuperAdmin<T>(
  request: Request,
  { path, parse }: Transport<T>,
) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request))
    return failure(403);
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause; // Preserve Next's dynamic-rendering signals.
  }
  if (!auth) return failure(401);
  if (!isSuperAdmin(auth.profile)) return failure(403);
  try {
    // No browser query, headers or identity reach Spring: only the session token.
    const upstream = await fetch(`${serverApiUrl()}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) {
      const status = [401, 403, 500, 503].includes(upstream.status)
        ? upstream.status
        : upstream.status >= 502
          ? 503
          : 502;
      return failure(status, upstream.headers.get("Retry-After"));
    }
    const body: unknown = await upstream.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw cause;
      return null;
    });
    const data = parse(body);
    return data
      ? Response.json(data, { headers: { "Cache-Control": "no-store" } })
      : failure(502);
  } catch {
    return failure(503);
  }
}
