import {
  parseCashCurrent,
  parseCashDetail,
  parseCashListing,
  parseCashPreview,
  parseCashProblemExtras,
  parseCashSettings,
} from "./contracts";
import { cashErrorCode, cashMessage } from "./errors";
import type {
  CashCurrent,
  CashDetail,
  CashListing,
  CashMovementKind,
  CashPreview,
  CashProblem,
  CashShift,
  CountLine,
} from "./types";

export type CashResult<T> =
  { ok: true; data: T } | { ok: false; problem: CashProblem };

const offline = (): CashProblem => ({
  status: 0,
  code: "CASH_OFFLINE",
  message: cashMessage("CASH_OFFLINE"),
});

const isOffline = () =>
  typeof navigator !== "undefined" && navigator.onLine === false;

async function request<T>(
  path: string,
  parse: (value: unknown) => T | null,
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<CashResult<T>> {
  // Offline, nothing is sent: a close never leaves the device half done.
  if (isOffline()) return { ok: false, problem: offline() };
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers:
        init.body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    if (isOffline()) return { ok: false, problem: offline() };
    const code = "CASH_TEMPORARILY_UNAVAILABLE";
    return {
      ok: false,
      problem: { status: 503, code, message: cashMessage(code) },
    };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status !== 200) {
    const raw =
      typeof body === "object" && body !== null && "code" in body
        ? body.code
        : undefined;
    const code = cashErrorCode(response.status, raw);
    const extras = parseCashProblemExtras(body);
    return {
      ok: false,
      problem: {
        status: response.status,
        code,
        message: cashMessage(code),
        ...(extras?.pendingOrders
          ? { pendingOrders: extras.pendingOrders }
          : {}),
        ...(extras?.preview ? { preview: extras.preview } : {}),
      },
    };
  }
  const data = parse(body);
  if (data === null) {
    const code = "CASH_BAD_GATEWAY";
    return {
      ok: false,
      problem: { status: 502, code, message: cashMessage(code) },
    };
  }
  return { ok: true, data };
}

const session = (id: string) => `/api/cash/sessions/${encodeURIComponent(id)}`;

export const cashApi = {
  current: () => request<CashCurrent>("/api/cash/current", parseCashCurrent),
  open: (shift: CashShift, openingFloat: number) =>
    request<CashCurrent>("/api/cash/sessions", parseCashCurrent, {
      method: "POST",
      body: { shift, openingFloat },
    }),
  movement: (
    sessionId: string,
    movement: {
      requestId: string;
      kind: CashMovementKind;
      amount: number;
      reason: string;
    },
  ) =>
    request<CashCurrent>(`${session(sessionId)}/movements`, parseCashCurrent, {
      method: "POST",
      body: movement,
    }),
  preview: (sessionId: string, lines: CountLine[]) =>
    request<CashPreview>(
      `${session(sessionId)}/close-preview`,
      parseCashPreview,
      {
        method: "POST",
        body: { lines },
      },
    ),
  close: (
    sessionId: string,
    command: {
      lines: CountLine[];
      note: string | null;
      expectedCash: number;
      expectedVersion: number;
      force?: boolean;
    },
  ) =>
    request<CashDetail>(`${session(sessionId)}/close`, parseCashDetail, {
      method: "POST",
      body: command,
    }),
  reopen: (sessionId: string, reason: string, expectedVersion: number) =>
    request<CashDetail>(`${session(sessionId)}/reopen`, parseCashDetail, {
      method: "POST",
      body: { reason, expectedVersion },
    }),
  detail: (sessionId: string, superAdmin = false) =>
    request<CashDetail>(
      superAdmin
        ? `/api/super-admin/cash/sessions/${encodeURIComponent(sessionId)}`
        : session(sessionId),
      parseCashDetail,
    ),
  list: (
    from: string,
    to: string,
    superAdmin = false,
    cafeteriaId?: string,
  ) => {
    const query = new URLSearchParams({ from, to });
    if (cafeteriaId) query.set("cafeteriaId", cafeteriaId);
    return request<CashListing>(
      `${superAdmin ? "/api/super-admin/cash" : "/api/cash"}/sessions?${query}`,
      parseCashListing,
    );
  },
  exportUrl: (
    from: string,
    to: string,
    superAdmin = false,
    cafeteriaId?: string,
  ) => {
    const query = new URLSearchParams({ from, to });
    if (cafeteriaId) query.set("cafeteriaId", cafeteriaId);
    return `${superAdmin ? "/api/super-admin/cash" : "/api/cash"}/sessions/export?${query}`;
  },
  tolerance: (toleranceCop: number, expectedVersion: number) =>
    request("/api/cash/settings", parseCashSettings, {
      method: "PUT",
      body: { toleranceCop, expectedVersion },
    }),
};
export type CashApi = typeof cashApi;
