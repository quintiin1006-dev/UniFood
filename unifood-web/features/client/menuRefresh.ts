import type { CafeteriaMenu } from "./types";

/** The catalogue is read again every 30 s while the tab is visible. */
export const MENU_REFRESH_MS = 30_000;
/** After failures the wait doubles, never above five minutes. */
export const MENU_MAX_BACKOFF_MS = 5 * 60_000;

export function nextMenuRefreshDelay(failures: number): number {
  if (failures <= 0) return MENU_REFRESH_MS;
  return Math.min(MENU_REFRESH_MS * 2 ** failures, MENU_MAX_BACKOFF_MS);
}

/** One read of the menu: a fresh menu, a cafeteria that is gone, or a failed read. */
export type MenuRead =
  | { kind: "ok"; menu: CafeteriaMenu }
  | { kind: "unavailable" }
  | { kind: "error" };

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The refresh loop without React. One read at a time; nothing is scheduled while the tab is
 * hidden; a read starts at once when the tab comes back or the window gets focus; a failed read
 * waits longer each time. `onResult` gets the read and the number of failures in a row.
 */
export function createMenuRefresher({
  load,
  onResult,
  isVisible,
  timers = browserTimers,
}: {
  load: () => Promise<MenuRead>;
  onResult: (read: MenuRead, failures: number) => void;
  isVisible: () => boolean;
  timers?: Timers;
}) {
  let handle: unknown = null;
  let failures = 0;
  let running = false;
  let inFlight = false;
  let again = false;

  const clearTimer = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const schedule = () => {
    clearTimer();
    if (!running || !isVisible()) return;
    handle = timers.set(() => void tick(), nextMenuRefreshDelay(failures));
  };
  async function tick() {
    handle = null;
    if (!running) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    let read: MenuRead;
    try {
      read = await load();
    } catch {
      read = { kind: "error" };
    }
    inFlight = false;
    if (!running) return;
    failures = read.kind === "error" ? failures + 1 : 0;
    onResult(read, failures);
    if (again) {
      again = false;
      void tick();
      return;
    }
    schedule();
  }

  /** Reads now, for example when the window gets focus. Hidden tabs do not read. */
  const refresh = () => {
    if (!running || !isVisible()) return;
    clearTimer();
    void tick();
  };

  return {
    /** `immediate` reads now (no menu yet); otherwise the first refresh waits its full time. */
    start(immediate: boolean) {
      if (running) return;
      running = true;
      failures = 0;
      if (immediate && isVisible()) void tick();
      else schedule();
    },
    stop() {
      running = false;
      clearTimer();
    },
    refresh,
    /** Call on every `visibilitychange`: hidden pauses, visible reads at once. */
    visibilityChanged() {
      if (!running) return;
      if (isVisible()) refresh();
      else clearTimer();
    },
  };
}

/** Two menus are the same when the page would look the same: no re-render on identical data. */
export function sameMenu(a: CafeteriaMenu, b: CafeteriaMenu): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The menu with only its orderable products: a product that stopped being available leaves the
 * catalogue and the carousel. Empty categories stay, so the page can say so.
 */
export function onlyAvailable(menu: CafeteriaMenu): CafeteriaMenu {
  return {
    ...menu,
    categories: menu.categories.map((category) => ({
      ...category,
      products: category.products.filter((product) => product.available),
    })),
  };
}
