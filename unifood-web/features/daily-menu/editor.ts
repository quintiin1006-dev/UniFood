import type { WorkerDailyMenu, WorkerDailyMenuCategory } from "./types";
import {
  BACKEND_ERROR_MESSAGES,
  DAILY_MENU_EDITOR_OFFLINE,
  DAILY_MENU_FIX_LENGTH,
  DAILY_MENU_NO_PRICE,
  dailyMenuCopyDone,
  dailyMenuMissingOption,
} from "../shared/messages";
import { dailyMenuErrorMessage } from "./errors";

/* ---------- Rules of the option chips (docs/propuesta-menu-dinamico.md 2.2 and 4.3) ---------- */

/** Sum of the chips plus the pending text of one category. */
export const MAX_CATEGORY_TEXT = 350;
export const MAX_OPTIONS = 20;

/** Ends trimmed and inner runs of spaces collapsed, as the server stores it. */
export const normalizeOption = (value: string) =>
  value.trim().replace(/\s+/g, " ");
/** Duplicates are compared without case, as the server's label_key. */
const optionKey = (value: string) =>
  normalizeOption(value).toLocaleLowerCase("es");

/** Characters a category uses: its chips and what is still typed in its field. */
export function textUsed(options: string[], pending: string) {
  return options.reduce(
    (sum, option) => sum + option.length,
    normalizeOption(pending.replace(/,/g, " ")).length,
  );
}
export const overLimit = (options: string[], pending: string) =>
  textUsed(options, pending) > MAX_CATEGORY_TEXT;

export type ChipError = "duplicate" | "max" | "tooLong";
export type DraftResult = {
  options: string[];
  /** What stays in the field. */
  rest: string;
  error: ChipError | null;
};

/**
 * Turns typed text into chips. A comma separates chips; with `final` (Enter) the last part is
 * a chip too, otherwise it stays in the field. A duplicate, the 21st option or going past 350
 * creates nothing more: the offending text stays in the field with the reason.
 */
export function commitDraft(
  options: string[],
  draft: string,
  final: boolean,
): DraftResult {
  const parts = draft.split(",");
  const pending = final ? "" : parts.pop()!;
  const next = [...options];
  for (let index = 0; index < parts.length; index++) {
    const option = normalizeOption(parts[index]);
    if (!option) continue;
    const rest = [...parts.slice(index), ...(final ? [] : [pending])].join(",");
    const stop = (error: ChipError) => ({ options: next, rest, error });
    if (next.some((existing) => optionKey(existing) === optionKey(option)))
      return stop("duplicate");
    if (next.length >= MAX_OPTIONS) return stop("max");
    if (textUsed([...next, option], pending) > MAX_CATEGORY_TEXT)
      return stop("tooLong");
    next.push(option);
  }
  return { options: next, rest: pending, error: null };
}

export function removeOption(options: string[], index: number) {
  return options.filter((_, position) => position !== index);
}

/* ---------- «Publicar menú» ---------- */

export type PublishCheck = {
  /** Visible reasons, in the screen's order. */
  reasons: string[];
  /** No price or a red box: the button is disabled. Missing options only show reasons. */
  disabled: boolean;
};

/** Required SINGLE categories still without an option, from what is on screen. */
export const missingCategories = (categories: WorkerDailyMenuCategory[]) =>
  categories
    .filter((category) => !category.canSkip && category.options.length === 0)
    .map(({ label }) => label);

export function publishCheck(
  day: WorkerDailyMenu,
  categories: WorkerDailyMenuCategory[],
  anyOverLimit: boolean,
): PublishCheck {
  if (!day.priceSet) return { reasons: [DAILY_MENU_NO_PRICE], disabled: true };
  if (anyOverLimit) return { reasons: [DAILY_MENU_FIX_LENGTH], disabled: true };
  return {
    reasons: missingCategories(categories).map(dailyMenuMissingOption),
    disabled: false,
  };
}

/* ---------- Confirmed state, optimistic overlay and the write queue ---------- */

export class DailyMenuApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(dailyMenuErrorMessage(code));
    this.name = "DailyMenuApiError";
  }
}

export type DailyMenuApi = {
  today(signal?: AbortSignal): Promise<WorkerDailyMenu>;
  options(
    day: string,
    version: number,
    categoryId: string,
    options: string[],
  ): Promise<WorkerDailyMenu>;
  addition(
    day: string,
    version: number,
    additionId: string,
    available: boolean,
  ): Promise<WorkerDailyMenu>;
  action(
    day: string,
    version: number,
    action: "copy-yesterday" | "publish" | "unpublish",
  ): Promise<WorkerDailyMenu>;
};

export type EditorNotice = { tone: "info" | "error"; text: string };
export type EditorSnapshot = {
  /** hidden: flag off, no daily menu for this worker or no permission: no editor at all. */
  status: "loading" | "ready" | "hidden" | "error";
  /** The last state the server confirmed. */
  day: WorkerDailyMenu | null;
  /** Categories and additions as shown: confirmed plus pending writes. */
  categories: WorkerDailyMenuCategory[];
  additions: WorkerDailyMenu["additions"];
  pending: number;
  /** A write or read could not reach the server; the last confirmed state stays. */
  offline: boolean;
  busyAction: "copy-yesterday" | "publish" | "unpublish" | null;
  notice: EditorNotice | null;
  /** Incremented when the day was read again after a conflict: the screen keeps typed text. */
  resync: number;
};

const NETWORK = new Set([0, 502, 503, 504]);
const RESYNC = new Set([
  "DAILY_MENU_VERSION_CONFLICT",
  "DAILY_MENU_DATE_CHANGED",
  "DAILY_MENU_INCOMPLETE",
  "DAILY_MENU_PRICE_NOT_SET",
  "DAILY_MENU_CATEGORY_NOT_FOUND",
]);
const HIDDEN = new Set([401, 403, 404]);
export const RETRY_MS = 5000;

/**
 * The editor's store. Writes run one after another so each sends the version the previous one
 * left (expectedVersion). Each category and addition has its own optimistic overlay
 * (features/availability/README.md): a success replaces the confirmed day, a failure drops that
 * overlay. A conflict or a changed day reads the day again and drops the queue; a lost
 * connection keeps the last confirmed state and reads again every RETRY_MS. A refresh never
 * runs while writes are pending.
 */
export class DailyMenuEditorStore {
  private day: WorkerDailyMenu | null = null;
  private status: EditorSnapshot["status"] = "loading";
  private optionOverlays = new Map<
    string,
    { token: number; options: string[] }
  >();
  private additionOverlays = new Map<string, { token: number; on: boolean }>();
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private token = 0;
  private pending = 0;
  private offline = false;
  private busyAction: EditorSnapshot["busyAction"] = null;
  private notice: EditorNotice | null = null;
  private resync = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;

  constructor(
    private readonly api: DailyMenuApi,
    private readonly timers: {
      set: typeof setTimeout;
      clear: typeof clearTimeout;
    } = { set: setTimeout, clear: clearTimeout },
  ) {
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }

  private build(): EditorSnapshot {
    const day = this.day;
    return {
      status: this.status,
      day,
      categories: (day?.categories ?? []).map((category) => {
        const overlay = this.optionOverlays.get(category.id);
        return overlay
          ? {
              ...category,
              options: overlay.options.map((label, index) => ({
                id:
                  category.options.find((option) => option.label === label)
                    ?.id ?? `pending-${index}`,
                label,
              })),
            }
          : category;
      }),
      additions: (day?.additions ?? []).map((addition) => {
        const overlay = this.additionOverlays.get(addition.id);
        return overlay ? { ...addition, available: overlay.on } : addition;
      }),
      pending: this.pending,
      offline: this.offline,
      busyAction: this.busyAction,
      notice: this.notice,
      resync: this.resync,
    };
  }

  /** First read, and every later one from the screen (poll, focus). */
  refresh = async () => {
    if (this.pending > 0 || this.disposed) return;
    await this.read();
  };

  private async read() {
    try {
      const day = await this.api.today();
      if (this.disposed) return;
      this.day = day;
      this.status = "ready";
      this.setOffline(false);
    } catch (cause) {
      if (this.disposed) return;
      const error = cause instanceof DailyMenuApiError ? cause : null;
      if (error && HIDDEN.has(error.status)) {
        this.status = "hidden";
        this.day = null;
      } else if (!error || NETWORK.has(error.status)) {
        if (!this.day) this.status = "error";
        this.setOffline(true);
      } else if (!this.day) this.status = "error";
    }
    this.emit();
  }

  private setOffline(offline: boolean) {
    this.offline = offline;
    if (this.retry) this.timers.clear(this.retry);
    this.retry = null;
    if (offline && !this.disposed)
      this.retry = this.timers.set(() => {
        this.retry = null;
        void this.refresh();
      }, RETRY_MS);
  }

  /** Replaces one category's options (each chip created or removed). */
  setOptions = (categoryId: string, options: string[]) => {
    const token = ++this.token;
    this.optionOverlays.set(categoryId, { token, options });
    return this.enqueue(
      (day) =>
        this.api.options(day.businessDate, day.version, categoryId, options),
      () => {
        if (this.optionOverlays.get(categoryId)?.token === token)
          this.optionOverlays.delete(categoryId);
      },
    );
  };

  /** Switches one addition; on, it keeps today's price (the server copies it). */
  setAddition = (additionId: string, on: boolean) => {
    const token = ++this.token;
    this.additionOverlays.set(additionId, { token, on });
    return this.enqueue(
      (day) => this.api.addition(day.businessDate, day.version, additionId, on),
      () => {
        if (this.additionOverlays.get(additionId)?.token === token)
          this.additionOverlays.delete(additionId);
      },
    );
  };

  /** «Copiar el de ayer», «Publicar menú» and «Despublicar». */
  runAction = (action: "copy-yesterday" | "publish" | "unpublish") => {
    this.busyAction = action;
    return this.enqueue(
      (day) => this.api.action(day.businessDate, day.version, action),
      () => {
        this.busyAction = null;
      },
      (result) => {
        if (action === "copy-yesterday")
          this.notice = {
            tone: "info",
            text: dailyMenuCopyDone(result.skippedCategories ?? []),
          };
      },
    );
  };

  private enqueue(
    write: (day: WorkerDailyMenu) => Promise<WorkerDailyMenu>,
    settle: () => void,
    done?: (result: WorkerDailyMenu) => void,
  ) {
    const generation = this.generation;
    this.pending++;
    this.notice = null;
    this.emit();
    const run = async () => {
      // Dropped by a conflict or a lost connection: the overlay goes, nothing is sent.
      if (generation !== this.generation || !this.day || this.disposed) {
        settle();
        return;
      }
      try {
        const result = await write(this.day);
        if (this.disposed) return;
        this.day = result;
        settle();
        done?.(result);
        this.setOffline(false);
      } catch (cause) {
        settle();
        if (this.disposed) return;
        await this.fail(cause);
      }
    };
    const task = this.chain.then(run).finally(() => {
      this.pending--;
      this.emit();
    });
    this.chain = task.catch(() => undefined);
    return task;
  }

  private async fail(cause: unknown) {
    const error =
      cause instanceof DailyMenuApiError
        ? cause
        : new DailyMenuApiError(503, "DAILY_MENU_TEMPORARILY_UNAVAILABLE");
    if (NETWORK.has(error.status)) {
      this.generation++;
      this.dropOverlays();
      this.notice = null;
      this.setOffline(true);
      return;
    }
    if (RESYNC.has(error.code)) {
      // Someone else changed the day (or it is another day): read it again, drop the queue.
      this.generation++;
      this.dropOverlays();
      this.notice = {
        tone: "error",
        text:
          error.code === "DAILY_MENU_VERSION_CONFLICT"
            ? BACKEND_ERROR_MESSAGES.DAILY_MENU_VERSION_CONFLICT
            : error.message,
      };
      this.resync++;
      await this.read();
      return;
    }
    this.notice = { tone: "error", text: error.message };
  }

  private dropOverlays() {
    this.optionOverlays.clear();
    this.additionOverlays.clear();
  }

  dispose = () => {
    this.disposed = true;
    if (this.retry) this.timers.clear(this.retry);
    this.retry = null;
    this.listeners.clear();
  };
}

/** The offline strip text, kept here so the store and the screen agree. */
export const OFFLINE_TEXT = DAILY_MENU_EDITOR_OFFLINE;
