import "server-only";
import { serverApiUrl, serverDailyMenuEnabled } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { isClient } from "@/features/auth/validation";
import { pickDailyMenu, isUuid } from "../contracts";
import { dailyMenuErrorMessage } from "../errors";

const TIMEOUT_MS = 15_000;

/** A malformed flag value counts as off. */
function flagOn() {
  try {
    return serverDailyMenuEnabled();
  } catch {
    return false;
  }
}

const fail = (status: number, code: string) =>
  Response.json(
    { message: dailyMenuErrorMessage(code), code },
    { status, headers: { "Cache-Control": "no-store" } },
  );

/**
 * GET /api/me/daily-menu?cafeteriaId= (docs/propuesta-menu-dinamico.md 4.1). With
 * MENU_DINAMICO_ENABLED off it answers 404 without calling Spring; the flag never leaves the
 * server. Session and CLIENT role come from the verified session. Only the published fields of
 * the contract are sent back, and backend errors are translated, never passed through.
 */
export async function forwardClientDailyMenu(request: Request) {
  if (!flagOn()) return fail(404, "DAILY_MENU_DISABLED");

  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "UNAUTHORIZED");
  if (!isClient(auth.profile)) return fail(403, "FORBIDDEN");

  const cafeteriaId = new URL(request.url).searchParams.get("cafeteriaId");
  if (!isUuid(cafeteriaId)) return fail(400, "INVALID_REQUEST");

  let upstream: Response;
  try {
    upstream = await fetch(
      `${serverApiUrl()}/api/me/daily-menu?cafeteriaId=${encodeURIComponent(cafeteriaId)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return fail(502, "BACKEND_UNAVAILABLE");
  }

  const json = (upstream.headers.get("content-type") || "").includes(
    "application/json",
  );
  const body: unknown = json ? await upstream.json().catch(() => null) : null;

  if (upstream.status === 200) {
    const menu = pickDailyMenu(body);
    // A menu for another cafeteria than the one asked for is never sent.
    if (!menu || menu.cafeteria.id.toLowerCase() !== cafeteriaId.toLowerCase())
      return fail(502, "BACKEND_UNAVAILABLE");
    return Response.json(menu, { headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status >= 400 && upstream.status < 500 && body) {
    const code = (body as { code?: unknown }).code;
    return fail(
      upstream.status,
      typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
        ? code
        : "DAILY_MENU_NOT_PUBLISHED",
    );
  }
  if (upstream.status === 503)
    return fail(503, "DAILY_MENU_TEMPORARILY_UNAVAILABLE");
  return fail(502, "BACKEND_UNAVAILABLE");
}
