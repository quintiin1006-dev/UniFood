/** Every minute while the app is visible; never faster. */
export const NOTICES_POLL_MS = 60_000;
export const NOTICES_MAX_BACKOFF_MS = 5 * 60_000;
/** A focus or visibility burst reads at most once in this gap. */
export const NOTICES_FOCUS_GAP_MS = 5_000;

/** 60 s while it works; doubling after consecutive failures, never above five minutes. */
export function nextNoticesDelay(failures: number): number {
  if (failures <= 0) return NOTICES_POLL_MS;
  return Math.min(NOTICES_POLL_MS * 2 ** failures, NOTICES_MAX_BACKOFF_MS);
}

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
};

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * The inbox refresh without React: one request at a time, a 60-second cadence that pauses while
 * the tab is hidden, an immediate read when the app is visible or focused again (at most once per
 * {@link NOTICES_FOCUS_GAP_MS}), and a growing delay after failures. `load` resolves true when it
 * worked; `fatal` stops the loop (the inbox is off on the server).
 */
export function createNoticesRefresher({
  load,
  isVisible,
  timers = defaultTimers,
}: {
  load: () => Promise<"ok" | "error" | "fatal">;
  isVisible: () => boolean;
  timers?: Timers;
}) {
  let failures = 0;
  let handle: unknown = null;
  let running = false;
  let inFlight = false;
  let lastStart = -Infinity;

  const clearTimer = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const schedule = () => {
    clearTimer();
    if (!running || !isVisible()) return;
    handle = timers.set(() => void tick(), nextNoticesDelay(failures));
  };
  async function tick() {
    handle = null;
    if (!running || inFlight) return;
    inFlight = true;
    lastStart = timers.now();
    let result: "ok" | "error" | "fatal";
    try {
      result = await load();
    } catch {
      result = "error";
    }
    inFlight = false;
    if (!running) return;
    if (result === "fatal") {
      running = false;
      clearTimer();
      return;
    }
    failures = result === "ok" ? 0 : failures + 1;
    schedule();
  }
  const readSoon = () => {
    if (!running || !isVisible() || inFlight) return;
    if (timers.now() - lastStart < NOTICES_FOCUS_GAP_MS) return;
    clearTimer();
    void tick();
  };

  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      if (isVisible()) void tick();
    },
    stop() {
      running = false;
      clearTimer();
    },
    /** Read now: the retry button or the panel opening. */
    refresh() {
      if (!running || inFlight) return;
      clearTimer();
      void tick();
    },
    /** `visibilitychange`: hidden pauses the cadence, visible reads at once. */
    visibilityChanged() {
      if (!running) return;
      if (isVisible()) readSoon();
      else clearTimer();
    },
    /** Window `focus`: back in the app, read at once. */
    focused: readSoon,
  };
}
