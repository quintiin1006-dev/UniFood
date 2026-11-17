import "server-only";
import { cookies } from "next/headers";
import { serverApiUrl } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import {
  isClient,
  isWorker,
  sameOrigin,
  type AuthProfile,
} from "@/features/auth/validation";
import {
  parsePublicKey,
  parseSubscribed,
  parseSubscriptionBody,
  parseUnsubscribeBody,
} from "../contracts";
import { PUSH_SUBSCRIPTION_COOKIE } from "./signOut";
import { PUSH_ERROR_MESSAGES, type PushErrorCode } from "../errors";
import type { PushRole } from "../state";

const MAX_BODY_BYTES = 4096;
const TIMEOUT_MS = 10000;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

const ROUTES: Record<
  PushRole,
  { base: string; admits: (p: AuthProfile) => boolean }
> = {
  client: {
    base: "/api/me/push",
    admits: (profile) =>
      isClient(profile) && profile.roles.every((role) => role === "CLIENT"),
  },
  worker: { base: "/api/worker/push", admits: isWorker },
};

function fail(status: number, code: PushErrorCode, retryAfter?: string) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return Response.json(
    { status, code, message: PUSH_ERROR_MESSAGES[code] },
    { status, headers },
  );
}

/** Spring's answer mapped to a fixed set; its body is never relayed as is. */
function upstreamFailure(upstream: Response) {
  const retry = upstream.headers.get("Retry-After");
  const safeRetry = retry && /^\d{1,3}$/.test(retry) ? retry : undefined;
  switch (upstream.status) {
    case 400:
      return fail(400, "PUSH_SUBSCRIPTION_INVALID");
    case 401:
      return fail(401, "UNAUTHORIZED");
    case 403:
      return fail(403, "FORBIDDEN");
    case 429:
      return fail(429, "PUSH_RATE_LIMITED", safeRetry ?? "60");
    case 503:
      return upstream.headers.get("content-type")?.includes("json")
        ? upstream
            .clone()
            .json()
            .then((body: { code?: unknown }) =>
              body?.code === "PUSH_DISABLED"
                ? fail(503, "PUSH_DISABLED")
                : fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", safeRetry ?? "5"),
            )
            .catch(() => fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", "5"))
        : fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", safeRetry ?? "5");
    default:
      return fail(502, "PUSH_UNAVAILABLE");
  }
}

type Session = { accessToken: string };

async function session(role: PushRole): Promise<Session | Response> {
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "UNAUTHORIZED");
  if (!ROUTES[role].admits(auth.profile)) return fail(403, "FORBIDDEN");
  return { accessToken: auth.accessToken };
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return undefined;
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function spring(path: string, accessToken: string, init: RequestInit) {
  // The bearer comes from the verified session; a browser Authorization is never read.
  return fetch(`${serverApiUrl()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** GET …/push/public-key: the VAPID public key, not a secret; 503 when push is disabled. */
export async function forwardPublicKey(role: PushRole) {
  const current = await session(role);
  if (current instanceof Response) return current;
  try {
    const upstream = await spring(
      `${ROUTES[role].base}/public-key`,
      current.accessToken,
      {
        method: "GET",
      },
    );
    if (upstream.status !== 200) return upstreamFailure(upstream);
    const key = parsePublicKey(await upstream.json().catch(() => null));
    return key
      ? Response.json(key, { headers: { "Cache-Control": "no-store" } })
      : fail(502, "PUSH_UNAVAILABLE");
  } catch {
    return fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", "5");
  }
}

/** POST …/push/subscribe: registers this browser for the signed-in user. */
export async function forwardSubscribe(request: Request, role: PushRole) {
  if (!sameOrigin(request)) return fail(403, "FORBIDDEN");
  const current = await session(role);
  if (current instanceof Response) return current;
  const body = parseSubscriptionBody(await readJson(request));
  if (!body) return fail(400, "PUSH_SUBSCRIPTION_INVALID");
  try {
    const upstream = await spring(
      `${ROUTES[role].base}/subscribe`,
      current.accessToken,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    if (upstream.status !== 200) return upstreamFailure(upstream);
    const subscribed = parseSubscribed(await upstream.json().catch(() => null));
    if (!subscribed) return fail(502, "PUSH_UNAVAILABLE");
    (await cookies()).set(PUSH_SUBSCRIPTION_COOKIE, subscribed.subscriptionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    return Response.json(
      { subscribed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", "5");
  }
}

/** DELETE …/push/subscribe: this browser's endpoint, only among the user's own rows. */
export async function forwardUnsubscribe(request: Request, role: PushRole) {
  if (!sameOrigin(request)) return fail(403, "FORBIDDEN");
  const current = await session(role);
  if (current instanceof Response) return current;
  const body = parseUnsubscribeBody(await readJson(request));
  if (!body) return fail(400, "PUSH_SUBSCRIPTION_INVALID");
  try {
    const upstream = await spring(
      `${ROUTES[role].base}/subscribe`,
      current.accessToken,
      {
        method: "DELETE",
        body: JSON.stringify(body),
      },
    );
    if (upstream.status !== 204) return upstreamFailure(upstream);
    (await cookies()).delete(PUSH_SUBSCRIPTION_COOKIE);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return fail(503, "PUSH_TEMPORARILY_UNAVAILABLE", "5");
  }
}
