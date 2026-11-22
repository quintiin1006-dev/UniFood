import "server-only";
import { serverApiUrl, serverDailyMenuEnabled } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { isClient, isWorker, sameOrigin } from "@/features/auth/validation";
import { DATE, pickDailyMenu, pickWorkerDay, isUuid } from "../contracts";
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

/* ---------- Worker: /api/worker/daily-menu/today/... (sections 3.1 and 4.1) ---------- */

export type WorkerOperation =
  | { kind: "read" }
  | { kind: "options"; categoryId: string }
  | { kind: "addition"; additionId: string }
  | { kind: "copy-yesterday" }
  | { kind: "publish" }
  | { kind: "unpublish" };

const MAX_WORKER_BODY = 16_384;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const isVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const exactly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** The write's body rebuilt from its own fields, or null: an extra field is refused. */
function workerBody(
  operation: WorkerOperation,
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!isVersion(body.expectedVersion)) return null;
  const expectedVersion = body.expectedVersion;
  if (operation.kind === "options") {
    if (!exactly(body, ["expectedVersion", "options"])) return null;
    const { options } = body;
    if (
      !Array.isArray(options) ||
      options.length > 20 ||
      options.some(
        (option) =>
          typeof option !== "string" || !option.trim() || option.length > 350,
      )
    )
      return null;
    return { expectedVersion, options: [...(options as string[])] };
  }
  if (operation.kind === "addition") {
    if (!exactly(body, ["expectedVersion", "available"])) return null;
    if (typeof body.available !== "boolean") return null;
    return { expectedVersion, available: body.available };
  }
  return exactly(body, ["expectedVersion"]) ? { expectedVersion } : null;
}

const workerPath = (operation: WorkerOperation) => {
  switch (operation.kind) {
    case "read":
      return "";
    case "options":
      return `/categories/${operation.categoryId.toLowerCase()}/options`;
    case "addition":
      return `/additions/${operation.additionId.toLowerCase()}`;
    default:
      return `/${operation.kind}`;
  }
};

/**
 * The worker's daily menu of today. With MENU_DINAMICO_ENABLED off it answers 404 without
 * calling Spring. Verified session, exclusive WORKER, sameOrigin on every write, a strict body
 * with expectedVersion and the screen's X-Business-Date. Only the published fields of the day
 * reach the browser; backend errors become a code and its catalogue text, never raw text.
 */
export async function forwardWorkerDailyMenu(
  request: Request,
  operation: WorkerOperation,
) {
  if (!flagOn()) return fail(404, "DAILY_MENU_DISABLED");
  const write = operation.kind !== "read";
  if (write && !sameOrigin(request)) return fail(403, "DAILY_MENU_FORBIDDEN");

  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return fail(401, "UNAUTHORIZED");
  if (
    !isWorker(auth.profile) ||
    auth.profile.roles.some((role) => role !== "WORKER")
  )
    return fail(403, "DAILY_MENU_FORBIDDEN");

  if (operation.kind === "options" && !isUuid(operation.categoryId))
    return fail(404, "DAILY_MENU_CATEGORY_NOT_FOUND");
  if (operation.kind === "addition" && !isUuid(operation.additionId))
    return fail(409, "DAILY_MENU_ADDITION_UNAVAILABLE");

  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    accept: "application/json",
  };
  let body: Record<string, unknown> | null = null;
  if (write) {
    const day = request.headers.get("X-Business-Date");
    const type = (request.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!day || !DATE.test(day) || type !== "application/json")
      return fail(400, "DAILY_MENU_INVALID_REQUEST");
    try {
      const raw = await request.text();
      if (raw.length > MAX_WORKER_BODY)
        return fail(400, "DAILY_MENU_INVALID_REQUEST");
      body = workerBody(operation, JSON.parse(raw));
    } catch {
      body = null;
    }
    if (!body) return fail(400, "DAILY_MENU_INVALID_REQUEST");
    headers["content-type"] = "application/json";
    headers["X-Business-Date"] = day;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${serverApiUrl()}/api/worker/daily-menu/today${workerPath(operation)}`,
      {
        method:
          operation.kind === "read"
            ? "GET"
            : operation.kind === "options" || operation.kind === "addition"
              ? "PUT"
              : "POST",
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return fail(503, "DAILY_MENU_TEMPORARILY_UNAVAILABLE");
  }

  const json = (upstream.headers.get("content-type") || "").includes(
    "application/json",
  );
  const data: unknown = json ? await upstream.json().catch(() => null) : null;
  if (upstream.status === 200) {
    const day = pickWorkerDay(data);
    return day
      ? Response.json(day, { headers: { "Cache-Control": "no-store" } })
      : fail(502, "BACKEND_UNAVAILABLE");
  }
  const code = (data as { code?: unknown } | null)?.code;
  if (upstream.status >= 400 && upstream.status < 500)
    return fail(
      upstream.status,
      typeof code === "string" && CODE.test(code)
        ? code
        : "DAILY_MENU_INVALID_REQUEST",
    );
  if (upstream.status === 503)
    return fail(503, "DAILY_MENU_TEMPORARILY_UNAVAILABLE");
  return fail(502, "BACKEND_UNAVAILABLE");
}
