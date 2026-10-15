import "server-only";
import { getAuth } from "@/features/auth/server/session";
import { isWorker } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { parseWorkerHistory } from "../contracts";
import { HISTORY_MESSAGES, historyErrorCode } from "../errors";

function failure(status: number, retry?: string | null) {
  const code = historyErrorCode(status);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 503)
    headers["Retry-After"] =
      retry && /^\d{1,3}$/.test(retry) && Number(retry) <= 300 ? retry : "5";
  return Response.json(
    { status, code, message: HISTORY_MESSAGES[code] },
    { status, headers },
  );
}

export async function forwardWorkerHistory() {
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause; // Preserve Next's dynamic-rendering signals.
  }
  if (!auth) return failure(401);
  if (!isWorker(auth.profile)) return failure(403);
  try {
    // Fixed path, verified token only: no browser headers, query parameters or IDs.
    const upstream = await fetch(
      `${serverApiUrl()}/api/worker/orders/history/today`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
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
    const data = parseWorkerHistory(body);
    return data
      ? Response.json(data, { headers: { "Cache-Control": "no-store" } })
      : failure(502);
  } catch {
    return failure(503);
  }
}
