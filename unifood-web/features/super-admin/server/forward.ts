import "server-only";
import { getAuth } from "@/features/auth/server/session";
import { isSuperAdmin, sameOrigin } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import {
  superAdminErrorCode,
  superAdminMessage,
  type SuperAdminErrorCode,
  type SuperAdminOperation,
} from "../errors";

const BODY_LIMIT = 1024;

type Transport<T> = {
  /** Built by the route from validated parts only; never from the browser's URL. */
  path: string;
  parse: (value: unknown) => T | null;
  operation?: SuperAdminOperation;
  /** Mutations: the validated body forwarded to Spring, or null for a 400. */
  body?: {
    method: "PATCH" | "PUT";
    parse: (value: unknown) => object | null;
    invalid: SuperAdminErrorCode;
  };
};

/** Statuses Spring may answer with, per operation; any other becomes 502 or 503. */
const PASSED: Record<SuperAdminOperation, readonly number[]> = {
  list: [401, 403, 500, 503],
  save: [400, 401, 403, 404, 409, 500, 503],
  audit: [400, 401, 403, 404, 500, 503],
};

export function superAdminFailure(
  status: number,
  {
    code = superAdminErrorCode(status),
    operation = "list",
    retry,
  }: {
    code?: SuperAdminErrorCode;
    operation?: SuperAdminOperation;
    retry?: string | null;
  } = {},
) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry && /^\d{1,3}$/.test(retry) && Number(retry) <= 300 ? retry : "5";
  return Response.json(
    { status, code, message: superAdminMessage(code, operation) },
    { status, headers },
  );
}

/** Reads at most BODY_LIMIT bytes of JSON; anything else is null. */
async function jsonBody(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    Number(request.headers.get("content-length")) > BODY_LIMIT ||
    !request.body
  )
    return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) return null;
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Shared transport for /api/super-admin/**: same origin for any mutation, verified session,
 * SUPER_ADMIN admission, strict body and the session's Bearer. Spring decides again from the
 * database.
 */
export async function forwardSuperAdmin<T>(
  request: Request,
  { path, parse, operation = "list", body }: Transport<T>,
) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request))
    return superAdminFailure(403, { operation });
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause; // Preserve Next's dynamic-rendering signals.
  }
  if (!auth) return superAdminFailure(401, { operation });
  if (!isSuperAdmin(auth.profile)) return superAdminFailure(403, { operation });
  let payload: string | undefined;
  if (body) {
    const command = body.parse(await jsonBody(request));
    if (!command)
      return superAdminFailure(400, { code: body.invalid, operation });
    payload = JSON.stringify(command);
  }
  try {
    // No browser query, headers or identity reach Spring: only the session token and,
    // for a mutation, the re-serialized validated body.
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      accept: "application/json",
    };
    if (payload !== undefined) headers["content-type"] = "application/json";
    const upstream = await fetch(`${serverApiUrl()}${path}`, {
      method: body ? body.method : "GET",
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) {
      const status = PASSED[operation].includes(upstream.status)
        ? upstream.status
        : upstream.status >= 502
          ? 503
          : 502;
      const problem: unknown =
        status === 400 || status === 404 || status === 409
          ? await upstream.json().catch(() => null)
          : null;
      const code = superAdminErrorCode(
        status,
        typeof problem === "object" && problem !== null && "code" in problem
          ? problem.code
          : undefined,
      );
      // A business status without its known code is not trusted.
      if (code === "SUPER_ADMIN_BAD_GATEWAY")
        return superAdminFailure(502, { operation });
      return superAdminFailure(status, {
        code,
        operation,
        retry: upstream.headers.get("Retry-After"),
      });
    }
    const data: unknown = await upstream.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw cause;
      return null;
    });
    const parsed = parse(data);
    return parsed
      ? Response.json(parsed, { headers: { "Cache-Control": "no-store" } })
      : superAdminFailure(502, { operation });
  } catch {
    return superAdminFailure(503, { operation });
  }
}
