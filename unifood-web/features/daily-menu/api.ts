import { pickWorkerDay, toClientDailyMenu } from "./contracts";
import { DailyMenuApiError, type DailyMenuApi } from "./editor";
import type { ClientDailyMenu, WorkerDailyMenu } from "./types";

const READ_TIMEOUT_MS = 15_000;

export type DailyMenuRead =
  | { kind: "ok"; menu: ClientDailyMenu }
  /** No menu, not published, flag off, or any failure: Inicio looks as it does today. */
  | { kind: "hidden" };

/** One read through the BFF. A menu failure never reaches the screen as an error. */
export async function readClientDailyMenu(
  cafeteriaId: string,
  signal?: AbortSignal,
): Promise<DailyMenuRead> {
  try {
    const response = await fetch(
      `/api/me/daily-menu?cafeteriaId=${encodeURIComponent(cafeteriaId)}`,
      {
        cache: "no-store",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)])
          : AbortSignal.timeout(READ_TIMEOUT_MS),
      },
    );
    if (!response.ok) return { kind: "hidden" };
    const menu = toClientDailyMenu(await response.json());
    return menu && menu.cafeteria.id === cafeteriaId
      ? { kind: "ok", menu }
      : { kind: "hidden" };
  } catch {
    return { kind: "hidden" };
  }
}

/* ---------- Worker editor ---------- */

const WORKER_ROOT = "/api/worker/daily-menu/today";
const WRITE_TIMEOUT_MS = 20_000;

/** One call through the worker BFF; a failure is a DailyMenuApiError with a public code. */
async function workerCall(
  path: string,
  init: RequestInit & { day?: string } = {},
): Promise<WorkerDailyMenu> {
  const { day, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${WORKER_ROOT}${path}`, {
      ...rest,
      headers: day
        ? {
            "content-type": "application/json",
            accept: "application/json",
            "X-Business-Date": day,
          }
        : { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: rest.signal
        ? AbortSignal.any([rest.signal, AbortSignal.timeout(WRITE_TIMEOUT_MS)])
        : AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch {
    throw new DailyMenuApiError(0, "DAILY_MENU_TEMPORARILY_UNAVAILABLE");
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status !== 200) {
    const code = (body as { code?: unknown } | null)?.code;
    throw new DailyMenuApiError(
      response.status,
      typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
        ? code
        : "DAILY_MENU_INTERNAL_ERROR",
    );
  }
  const menu = pickWorkerDay(body);
  if (!menu) throw new DailyMenuApiError(502, "BACKEND_UNAVAILABLE");
  return menu;
}

export const workerDailyMenuApi: DailyMenuApi = {
  today: (signal) => workerCall("", { method: "GET", signal }),
  options: (day, expectedVersion, categoryId, options) =>
    workerCall(`/categories/${encodeURIComponent(categoryId)}/options`, {
      method: "PUT",
      day,
      body: JSON.stringify({ expectedVersion, options }),
    }),
  addition: (day, expectedVersion, additionId, available) =>
    workerCall(`/additions/${encodeURIComponent(additionId)}`, {
      method: "PUT",
      day,
      body: JSON.stringify({ expectedVersion, available }),
    }),
  action: (day, expectedVersion, action) =>
    workerCall(`/${action}`, {
      method: "POST",
      day,
      body: JSON.stringify({ expectedVersion }),
    }),
};
