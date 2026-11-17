import "server-only";
import { getAuth } from "@/features/auth/server/session";
import {
  isAdmin,
  isSuperAdmin,
  isWorker,
  sameOrigin,
} from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { parseCashProblemExtras } from "../contracts";
import { cashErrorCode, cashMessage, type CashErrorCode } from "../errors";

const BODY_LIMIT = 4096;
const CSV_LIMIT = 5 * 1024 * 1024;

/** Who may call: the cafeteria's WORKER or ADMIN, only its ADMIN, or SUPER_ADMIN (read). */
export type CashAudience = "operator" | "admin" | "superAdmin";

type Transport<T> = {
  /** Built by the route from validated parts only; never from the browser's URL. */
  path: string;
  audience: CashAudience;
  parse: (value: unknown) => T | null;
  /** Mutations: the validated body forwarded to Spring, or null for a 400. */
  body?: { method: "POST" | "PUT"; parse: (value: unknown) => object | null };
};

const RETRY = (retry: string | null | undefined, fallback: string) =>
  retry && /^\d{1,3}$/.test(retry) && Number(retry) <= 300 ? retry : fallback;

export function cashFailure(
  status: number,
  {
    code = cashErrorCode(status),
    retry,
    extras,
  }: {
    code?: CashErrorCode;
    retry?: string | null;
    extras?: object | null;
  } = {},
) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503) headers["Retry-After"] = RETRY(retry, "5");
  if (code === "CASH_BUSY") headers["Retry-After"] = RETRY(retry, "3");
  return Response.json(
    { status, code, message: cashMessage(code), ...(extras ?? {}) },
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

type Admitted = { token: string } | { response: Response };

/** Same origin for any mutation, verified session and role. Spring decides again from the DB. */
async function admit(
  request: Request,
  audience: CashAudience,
): Promise<Admitted> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request))
    return { response: cashFailure(403) };
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause))
      return { response: temporaryAuthResponse() };
    throw cause; // Preserve Next's dynamic-rendering signals.
  }
  if (!auth) return { response: cashFailure(401) };
  const allowed =
    audience === "superAdmin"
      ? isSuperAdmin(auth.profile)
      : audience === "admin"
        ? isAdmin(auth.profile) && !isSuperAdmin(auth.profile)
        : isWorker(auth.profile) ||
          (isAdmin(auth.profile) && !isSuperAdmin(auth.profile));
  if (!allowed) return { response: cashFailure(403) };
  return { token: auth.accessToken };
}

const upstreamStatus = (status: number) =>
  [400, 401, 403, 404, 409, 500, 503].includes(status)
    ? status
    : status >= 502
      ? 503
      : 502;

export async function forwardCash<T>(
  request: Request,
  { path, audience, parse, body }: Transport<T>,
) {
  const admitted = await admit(request, audience);
  if ("response" in admitted) return admitted.response;
  let payload: string | undefined;
  if (body) {
    const command = body.parse(await jsonBody(request));
    if (!command) return cashFailure(400, { code: "CASH_INVALID_REQUEST" });
    payload = JSON.stringify(command);
  }
  try {
    // No browser query, headers or identity reach Spring: only the session token and, for a
    // mutation, the re-serialized validated body. Never a cafeteria id.
    const headers: Record<string, string> = {
      authorization: `Bearer ${admitted.token}`,
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
      const status = upstreamStatus(upstream.status);
      const problem: unknown =
        status === 400 || status === 404 || status === 409
          ? await upstream.json().catch(() => null)
          : null;
      const code = cashErrorCode(
        status,
        typeof problem === "object" && problem !== null && "code" in problem
          ? problem.code
          : undefined,
      );
      if (code === "CASH_BAD_GATEWAY") return cashFailure(502);
      // Only the extras of their codes, re-parsed; never Spring's message.
      const extras =
        code === "CASH_PENDING_ORDERS" || code === "CASH_EXPECTED_CHANGED"
          ? parseCashProblemExtras(problem)
          : null;
      return cashFailure(status, {
        code,
        retry: upstream.headers.get("Retry-After"),
        extras,
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
      : cashFailure(502);
  } catch {
    return cashFailure(503);
  }
}

/** CSV export: passes the bytes through, only text/csv and at most 5 MB. */
export async function forwardCashCsv(
  request: Request,
  { path, audience }: { path: string; audience: CashAudience },
) {
  const admitted = await admit(request, audience);
  if ("response" in admitted) return admitted.response;
  try {
    const upstream = await fetch(`${serverApiUrl()}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${admitted.token}`,
        accept: "text/csv",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) {
      const status = upstreamStatus(upstream.status);
      const problem: unknown =
        status === 400 || status === 404 || status === 409
          ? await upstream.json().catch(() => null)
          : null;
      const code = cashErrorCode(
        status,
        typeof problem === "object" && problem !== null && "code" in problem
          ? problem.code
          : undefined,
      );
      return cashFailure(code === "CASH_BAD_GATEWAY" ? 502 : status, {
        code,
        retry: upstream.headers.get("Retry-After"),
      });
    }
    if (!/^text\/csv/i.test(upstream.headers.get("content-type") ?? ""))
      return cashFailure(502);
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > CSV_LIMIT) return cashFailure(502);
    const disposition = upstream.headers.get("content-disposition") ?? "";
    const name = /filename="?(cierres-de-caja-[0-9a-z-]+\.csv)"?/i.exec(
      disposition,
    )?.[1];
    return new Response(bytes, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name ?? "cierres-de-caja.csv"}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return cashFailure(503);
  }
}
