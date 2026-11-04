import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getVerifiedAuthIdentity } from "@/features/auth/server/identity";
import { authClient } from "@/features/auth/server/client";
import { isAdmin, type AuthProfile } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  isTemporaryAuthFailure,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { parseAdminDashboard } from "../contracts";
import { dashboardSearch, parseDashboardFilters } from "../filters";
import { DASHBOARD_MESSAGES, dashboardErrorCode } from "../errors";

function failure(status: number, retry?: string | null, auth = false) {
  const code = dashboardErrorCode(
    status,
    auth ? "AUTH_TEMPORARILY_UNAVAILABLE" : undefined,
  );
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry && /^[1-9][0-9]{0,2}$/.test(retry) && Number(retry) <= 300
        ? retry
        : "5";
  return Response.json(
    { status, code, message: DASHBOARD_MESSAGES[code] },
    { status, headers },
  );
}
function timedOut(cause: unknown) {
  return (
    cause instanceof Error &&
    ["AbortError", "TimeoutError"].includes(cause.name)
  );
}

export async function forwardAdminDashboard(
  request: Request,
  now = new Date(),
) {
  let identity: Awaited<ReturnType<typeof getVerifiedAuthIdentity>>;
  try {
    identity = await getVerifiedAuthIdentity();
    if (
      !identity ||
      typeof identity.id !== "string" ||
      !identity.id ||
      typeof identity.accessToken !== "string" ||
      !identity.accessToken.trim()
    )
      return failure(401);
    const client = await authClient();
    const { data, error, status } = await client.rpc("current_auth_profile");
    if (error && status === 401) return failure(401);
    if (error && status === 403) return failure(403);
    if (error)
      return isTemporaryAuthFailure(error)
        ? failure(503, null, true)
        : failure(403);
    if (!data || data.id !== identity.id || !isAdmin(data as AuthProfile))
      return failure(403);
  } catch (cause) {
    unstable_rethrow(cause);
    if (isAuthServiceUnavailable(cause) || isTemporaryAuthFailure(cause))
      return failure(503, null, true);
    return failure(401);
  }
  const filters = parseDashboardFilters(new URL(request.url).searchParams, now);
  if (!filters) return failure(400);
  let url: URL;
  try {
    // The configured server origin/path and reconstructed allowlist are the only URL inputs.
    url = new URL(serverApiUrl() + "/api/admin/dashboard");
    url.search = dashboardSearch(filters).toString();
  } catch {
    return failure(500);
  }
  try {
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: "Bearer " + identity.accessToken,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) {
      const status = [400, 401, 403, 500, 502, 503].includes(upstream.status)
        ? upstream.status
        : [408, 429, 504].includes(upstream.status)
          ? 503
          : 502;
      // No upstream body, Set-Cookie, Location, URL or exception message is public.
      await upstream.body?.cancel().catch(() => {});
      return failure(status, upstream.headers.get("Retry-After"));
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        upstream.headers.get("Content-Type") ?? "",
      )
    ) {
      await upstream.body?.cancel().catch(() => {});
      return failure(502);
    }
    const raw: unknown = await upstream.json();
    const dashboard = parseAdminDashboard(raw, filters);
    return dashboard
      ? Response.json(dashboard, { headers: { "Cache-Control": "no-store" } })
      : failure(502);
  } catch (cause) {
    unstable_rethrow(cause);
    return failure(timedOut(cause) ? 503 : 502);
  }
}
