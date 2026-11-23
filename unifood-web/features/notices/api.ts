import { parseNotices } from "./contracts";
import { noticesErrorMessage } from "./errors";
import type { NoticesPayload } from "./types";

export type NoticesRead =
  | { kind: "ok"; payload: NoticesPayload }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

const TIMEOUT_MS = 10_000;

async function code(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object"
    ? (body as { code?: unknown }).code
    : undefined;
}

/** GET /api/me/notices through the BFF; never cached by the browser. */
export async function fetchNotices(): Promise<NoticesRead> {
  let response: Response;
  try {
    response = await fetch("/api/me/notices", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "error", message: noticesErrorMessage(undefined) };
  }
  if (response.status === 404) return { kind: "disabled" };
  if (response.status !== 200)
    return {
      kind: "error",
      message: noticesErrorMessage(await code(response)),
    };
  const payload = parseNotices(
    await response.json().catch(() => null),
    Date.now(),
  );
  return payload
    ? { kind: "ok", payload }
    : { kind: "error", message: noticesErrorMessage(undefined) };
}

/** POST /api/me/notices/read: idempotent; a failure only leaves the dot for the next read. */
export async function markNoticesRead(): Promise<boolean> {
  try {
    const response = await fetch("/api/me/notices/read", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
