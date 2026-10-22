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
import { parseAdminCatalog } from "../contracts";
import { CATALOG_MESSAGES, catalogErrorCode } from "../errors";

function failure(status: number, retry?: string | null, auth = false) {
  const code = catalogErrorCode(
    status,
    auth ? "AUTH_TEMPORARILY_UNAVAILABLE" : undefined,
  );
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry &&
      /^\d{1,3}$/.test(retry) &&
      Number(retry) > 0 &&
      Number(retry) <= 300
        ? retry
        : "5";
  return Response.json(
    { status, code, message: CATALOG_MESSAGES[code] },
    { status, headers },
  );
}

/** Profile transport would add email to this contract. Keep this catalog projection independent. */
export async function forwardAdminCatalog() {
  let identity: Awaited<ReturnType<typeof getVerifiedAuthIdentity>>;
  try {
    identity = await getVerifiedAuthIdentity();
    if (!identity) return failure(401);
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
  try {
    // No browser URL, headers, body or tenant selectors are forwarded.
    const upstream = await fetch(serverApiUrl() + "/api/admin/catalog", {
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
    const catalog = parseAdminCatalog(body);
    return catalog
      ? Response.json(catalog, { headers: { "Cache-Control": "no-store" } })
      : failure(502);
  } catch {
    return failure(503);
  }
}
