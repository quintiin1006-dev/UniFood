import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getVerifiedAuthIdentity } from "@/features/auth/server/identity";
import { authClient } from "@/features/auth/server/client";
import {
  isAdmin,
  sameOrigin,
  type AuthProfile,
} from "@/features/auth/validation";
import { catalogUuid, parseCatalogCommand } from "../commands";
import { catalogRequestBody } from "./body";
import {
  isAuthServiceUnavailable,
  isTemporaryAuthFailure,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { parseAdminCatalog } from "../contracts";
import { CATALOG_MESSAGES, catalogErrorCode } from "../errors";

function failure(
  status: number,
  retry?: string | null,
  auth = false,
  publicCode?: unknown,
) {
  const code = catalogErrorCode(
    status,
    auth ? "AUTH_TEMPORARILY_UNAVAILABLE" : publicCode,
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
export async function forwardAdminCatalog(
  request?: Request,
  kind?: "create" | "edit" | "status",
  id?: string,
) {
  if (kind && (!request || !sameOrigin(request))) return failure(403);
  let identity: Awaited<ReturnType<typeof getVerifiedAuthIdentity>>;
  let command: Record<string, unknown> | null = null;
  if (kind) {
    if (kind !== "create" && !catalogUuid(id)) return failure(400);
    try {
      command = parseCatalogCommand(await catalogRequestBody(request!), kind);
    } catch {
      return failure(400);
    }
    if (!command) return failure(400);
  }
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
    const path =
      "/api/admin/catalog" +
      (kind && kind !== "create"
        ? "/" + id + (kind === "status" ? "/status" : "")
        : "");
    const upstream = await fetch(serverApiUrl() + path, {
      method: kind === "create" ? "POST" : kind ? "PATCH" : "GET",
      headers: {
        authorization: "Bearer " + identity.accessToken,
        accept: "application/json",
        ...(kind ? { "content-type": "application/json" } : {}),
      },
      ...(kind ? { body: JSON.stringify(command) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== (kind === "create" ? 201 : 200)) {
      const status = (kind
        ? [400, 401, 403, 404, 409, 500, 503]
        : [401, 403, 500, 503]
      ).includes(upstream.status)
        ? upstream.status
        : upstream.status >= 502
          ? 503
          : 502;
      const error = await upstream.json().catch(() => null);
      return failure(
        status,
        upstream.headers.get("Retry-After"),
        false,
        error?.code,
      );
    }
    const body: unknown = await upstream.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw cause;
      return null;
    });
    const catalog = parseAdminCatalog(kind ? { products: [body] } : body);
    return catalog
      ? Response.json(kind ? catalog.products[0] : catalog, {
          status: kind === "create" ? 201 : 200,
          headers: { "Cache-Control": "no-store" },
        })
      : failure(502);
  } catch {
    return failure(503);
  }
}
export const forwardAdminCatalogMutation = (
  request: Request,
  kind: "create" | "edit" | "status",
  id?: string,
) => forwardAdminCatalog(request, kind, id);
