import "server-only";
import { getAuth } from "@/features/auth/server/session";
import { isWorker, sameOrigin } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import {
  isBusinessDate,
  isUuid,
  parseBooleanBody,
  parseToday,
  record,
} from "../contracts";
import {
  AVAILABILITY_MESSAGES,
  publicErrorCode,
  type AvailabilityErrorCode,
} from "../errors";

type Operation =
  { kind: "read" } | { kind: "cafeteria" } | { kind: "item"; itemId: string };
function failure(
  status: number,
  code: AvailabilityErrorCode = publicErrorCode(status),
  retry?: string | null,
) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry && /^\d{1,3}$/.test(retry) && Number(retry) <= 300 ? retry : "5";
  return Response.json(
    { status, code, message: AVAILABILITY_MESSAGES[code] },
    { status, headers },
  );
}

export async function forwardAvailability(
  request: Request,
  operation: Operation,
) {
  const mutation = operation.kind !== "read";
  if (mutation && !sameOrigin(request)) return failure(403);
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return failure(401);
  if (!isWorker(auth.profile)) return failure(403);
  if (operation.kind === "item" && !isUuid(operation.itemId))
    return failure(400);

  const day = request.headers.get("X-Business-Date");
  const field = operation.kind === "item" ? "available" : "open";
  let value: boolean | null = null;
  if (mutation) {
    if (
      !isBusinessDate(day) ||
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return failure(400);
    try {
      const raw = await request.text();
      if (raw.length > 1024) return failure(400);
      value = parseBooleanBody(JSON.parse(raw), field);
    } catch {
      return failure(400);
    }
    if (value === null) return failure(400);
  }
  const suffix =
    operation.kind === "item"
      ? `/items/${operation.itemId}`
      : operation.kind === "cafeteria"
        ? "/cafeteria-state"
        : "";
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    accept: "application/json",
  };
  if (mutation) {
    headers["Content-Type"] = "application/json";
    headers["X-Business-Date"] = day!;
  }
  try {
    const upstream = await fetch(
      `${serverApiUrl()}/api/worker/availability/today${suffix}`,
      {
        method: mutation ? "PUT" : "GET",
        headers,
        ...(mutation ? { body: JSON.stringify({ [field]: value }) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const data: unknown = await upstream.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw cause;
      return null;
    });
    if (upstream.status !== 200) {
      const status = [400, 401, 403, 404, 409, 500, 503].includes(
        upstream.status,
      )
        ? upstream.status
        : upstream.status >= 502
          ? 503
          : 502;
      return failure(
        status,
        publicErrorCode(status, record(data) ? data.code : undefined),
        upstream.headers.get("Retry-After"),
      );
    }
    if (operation.kind === "read") {
      const today = parseToday(data);
      return today
        ? Response.json(today, { headers: { "Cache-Control": "no-store" } })
        : failure(502);
    }
    if (
      !record(data) ||
      data.businessDate !== day ||
      typeof data[field] !== "boolean" ||
      data[field] !== value ||
      (operation.kind === "item" &&
        (typeof data.itemId !== "string" ||
          data.itemId.toLowerCase() !== operation.itemId.toLowerCase()))
    )
      return failure(502);
    const result =
      operation.kind === "item"
        ? {
            businessDate: data.businessDate,
            itemId: data.itemId,
            available: data.available,
          }
        : { businessDate: data.businessDate, open: data.open };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure(503);
  }
}
