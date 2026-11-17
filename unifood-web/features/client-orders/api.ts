import { toClientOrder, toHistoryPage } from "./contracts";
import {
  cancelFailure,
  connectionFailure,
  orderFailure,
  type OrderFailure,
} from "./errors";
import type { PollResult } from "./polling";
import type { ClientOrder, OrderHistoryPage } from "./types";

// Every call goes to the BFF of this origin; the browser never reaches Spring (CLAUDE.md).
const TIMEOUT_MS = 12_000;

export type Outcome<T> =
  { ok: true; value: T } | { ok: false; failure: OrderFailure };

const signal = () => AbortSignal.timeout(TIMEOUT_MS);

async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const code = (body as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/** One poll of GET /api/me/orders/current with the last ETag (304 means nothing changed). */
export async function pollCurrentOrder(
  etag: string | null,
): Promise<PollResult> {
  let response: Response;
  try {
    response = await fetch("/api/me/orders/current", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(etag ? { "if-none-match": etag } : {}),
      },
      signal: signal(),
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 304) return { kind: "unchanged" };
  // Session over or no permission: retrying never helps, so the polling stops with a clear message.
  if (response.status === 401 || response.status === 403)
    return {
      kind: "error",
      fatal: true,
      failure: orderFailure(response.status),
    };
  if (response.status !== 200) return { kind: "error" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "error" };
  }
  const tag = response.headers.get("etag");
  if (body === null) return { kind: "none", etag: tag };
  const order = toClientOrder(body);
  return order ? { kind: "order", order, etag: tag } : { kind: "error" };
}

/** GET /api/me/orders/{id}: the detail, also the last state of an order that is no longer active. */
export async function fetchOrder(id: string): Promise<Outcome<ClientOrder>> {
  try {
    const response = await fetch(`/api/me/orders/${encodeURIComponent(id)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: signal(),
    });
    if (response.status !== 200)
      return {
        ok: false,
        failure: orderFailure(response.status, await codeOf(response)),
      };
    const order = toClientOrder(await response.json());
    return order
      ? { ok: true, value: order }
      : { ok: false, failure: connectionFailure() };
  } catch {
    return { ok: false, failure: connectionFailure() };
  }
}

/** GET /api/me/orders: one page, newest first; `cursor` is Spring's opaque value. */
export async function fetchHistory(
  cursor: string | null,
): Promise<Outcome<OrderHistoryPage>> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  try {
    const response = await fetch(`/api/me/orders?${query}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: signal(),
    });
    if (response.status !== 200)
      return {
        ok: false,
        failure: orderFailure(response.status, await codeOf(response)),
      };
    const page = toHistoryPage(await response.json());
    return page
      ? { ok: true, value: page }
      : { ok: false, failure: connectionFailure() };
  } catch {
    return { ok: false, failure: connectionFailure() };
  }
}

/** PATCH /api/me/orders/{id}/cancel: only a PENDING order of the owner can be cancelled. */
export async function cancelOrder(id: string): Promise<Outcome<null>> {
  try {
    const response = await fetch(
      `/api/me/orders/${encodeURIComponent(id)}/cancel`,
      {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: signal(),
      },
    );
    if (response.status === 200) return { ok: true, value: null };
    return {
      ok: false,
      failure: cancelFailure(response.status, await codeOf(response)),
    };
  } catch {
    return { ok: false, failure: connectionFailure() };
  }
}
