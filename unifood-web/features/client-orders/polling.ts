import type { ClientOrder } from "./types";

export const POLL_MS = 5000;
export const MAX_BACKOFF_MS = 60_000;

/** 5 s while it works; doubling after each consecutive failure, never above one minute. */
export function nextDelay(failures: number): number {
  if (failures <= 0) return POLL_MS;
  return Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS);
}

export type OrderAlert = "preparing" | "ready" | "reminder";

type Seen = Pick<ClientOrder, "id" | "status" | "reminderCount">;

/**
 * What the client must be told when the polled order moves: «en preparación», «listo» (READY or
 * CALLED) and each new reminder of a CALLED order. The first reading is never an alert.
 */
export function alertFor(
  previous: Seen | null,
  next: Seen | null,
): OrderAlert | null {
  if (!previous || !next || previous.id !== next.id) return null;
  const waiting = (status: string) => status === "READY" || status === "CALLED";
  if (previous.status === "PENDING" && next.status === "PREPARING")
    return "preparing";
  if (!waiting(previous.status) && waiting(next.status)) return "ready";
  if (
    next.status === "CALLED" &&
    previous.status === "CALLED" &&
    next.reminderCount > previous.reminderCount
  )
    return "reminder";
  return null;
}

export const ALERT_TEXT: Record<OrderAlert, string> = {
  preparing: "Tu pedido está en preparación.",
  ready: "Tu pedido está listo. Pasa a recogerlo.",
  reminder: "Te seguimos esperando: tu pedido está listo.",
};

/** Tab title while the order waits for the client; null leaves the page's own title. */
export function tabTitle(status: string | null): string | null {
  if (status === "READY" || status === "CALLED")
    return "Tu pedido está listo | UniFood";
  if (status === "PREPARING") return "Preparando tu pedido | UniFood";
  return null;
}

export type PollResult =
  | { kind: "order"; order: ClientOrder; etag: string | null }
  | { kind: "none"; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "error"; fatal?: boolean };

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

/**
 * The polling loop without React: one request at a time, the ETag sent back, a pause while the
 * tab is hidden, an immediate read when it returns and a growing delay after failures.
 */
export function createPoller({
  load,
  onResult,
  isVisible,
  timers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: {
  load: (etag: string | null) => Promise<PollResult>;
  onResult: (result: PollResult, failures: number) => void;
  isVisible: () => boolean;
  timers?: Timers;
}) {
  let etag: string | null = null;
  let failures = 0;
  let handle: unknown = null;
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
    handle = timers.set(() => void tick(), nextDelay(failures));
  };
  async function tick() {
    handle = null;
    if (!running) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    let result: PollResult;
    try {
      result = await load(etag);
    } catch {
      result = { kind: "error" };
    }
    inFlight = false;
    if (!running) return;
    if (result.kind === "error") failures += 1;
    else {
      failures = 0;
      if (result.kind !== "unchanged") etag = result.etag;
    }
    onResult(result, failures);
    if (result.kind === "error" && result.fatal) {
      running = false;
      return;
    }
    if (again) {
      again = false;
      void tick();
      return;
    }
    schedule();
  }

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
    /** Read now, for example right after cancelling. */
    refresh() {
      if (!running) return;
      clearTimer();
      void tick();
    },
    /** Call on every `visibilitychange`: hidden pauses, visible reads at once. */
    visibilityChanged() {
      if (!running) return;
      if (isVisible()) {
        clearTimer();
        void tick();
      } else clearTimer();
    },
  };
}
