import { toClientDailyMenu } from "./contracts";
import type { ClientDailyMenu } from "./types";

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
