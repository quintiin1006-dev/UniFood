import "server-only";
import { serverApiUrl, serverNoticesEnabled } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import {
  isClient,
  sameOrigin,
  type AuthProfile,
} from "@/features/auth/validation";
import { parseNotices } from "../contracts";
import { noticesErrorMessage, type NoticesErrorCode } from "../errors";

const TIMEOUT_MS = 10_000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(status: number, code: NoticesErrorCode, retryAfter?: string) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return Response.json(
    { status, code, message: noticesErrorMessage(code) },
    { status, headers },
  );
}

/** Only an account whose one business role is CLIENT has an inbox. */
const admits = (profile: AuthProfile) =>
  isClient(profile) && profile.roles.every((role) => role === "CLIENT");

async function session(): Promise<{ accessToken: string } | Response> {
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "UNAUTHORIZED");
  if (!admits(auth.profile)) return fail(403, "FORBIDDEN");
  return { accessToken: auth.accessToken };
}

function spring(path: string, accessToken: string, method: "GET" | "POST") {
  // The bearer comes from the verified session; nothing of the browser request is forwarded.
  return fetch(`${serverApiUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Spring's failure mapped to a fixed set; its body is never relayed. */
function upstreamFailure(upstream: Response) {
  switch (upstream.status) {
    case 401:
      return fail(401, "UNAUTHORIZED");
    case 403:
      return fail(403, "ORDER_NOTICES_FORBIDDEN");
    case 404:
      return fail(404, "ORDER_NOTICES_DISABLED");
    case 503:
      return fail(503, "ORDER_NOTICES_TEMPORARILY_UNAVAILABLE", "5");
    default:
      return fail(502, "BACKEND_UNAVAILABLE");
  }
}

/**
 * GET /api/me/notices: the signed-in client's recent notices. With AVISOS_BANDEJA_ENABLED off it
 * answers 404 without calling Spring; the flag never leaves the server. Every answer is no-store.
 */
export async function forwardNotices() {
  if (!serverNoticesEnabled()) return fail(404, "ORDER_NOTICES_DISABLED");
  const current = await session();
  if (current instanceof Response) return current;
  try {
    const upstream = await spring(
      "/api/me/notices",
      current.accessToken,
      "GET",
    );
    if (upstream.status !== 200) return upstreamFailure(upstream);
    const payload = parseNotices(
      await upstream.json().catch(() => null),
      Date.now(),
    );
    return payload
      ? Response.json(payload, { headers: NO_STORE })
      : fail(502, "BACKEND_UNAVAILABLE");
  } catch {
    return fail(503, "ORDER_NOTICES_TEMPORARILY_UNAVAILABLE", "5");
  }
}

/** POST /api/me/notices/read: same origin only; idempotent, 200 also when nothing was unread. */
export async function forwardMarkNoticesRead(request: Request) {
  if (!serverNoticesEnabled()) return fail(404, "ORDER_NOTICES_DISABLED");
  if (!sameOrigin(request)) return fail(403, "FORBIDDEN");
  const current = await session();
  if (current instanceof Response) return current;
  try {
    const upstream = await spring(
      "/api/me/notices/read",
      current.accessToken,
      "POST",
    );
    if (upstream.status !== 200) return upstreamFailure(upstream);
    return Response.json({ unread: 0 }, { headers: NO_STORE });
  } catch {
    return fail(503, "ORDER_NOTICES_TEMPORARILY_UNAVAILABLE", "5");
  }
}
