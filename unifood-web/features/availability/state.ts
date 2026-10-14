import type { AvailabilityApi } from "./api";
import { AvailabilityApiError } from "./errors";
import type { TodayAvailability } from "./types";

export type AvailabilityState = {
  data: TodayAvailability | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notice: string | null;
  busyItems: string[];
  cafeteriaBusy: boolean;
  itemErrors: Record<string, string>;
  cafeteriaError: string | null;
};
const initial = (): AvailabilityState => ({
  data: null,
  loading: true,
  refreshing: false,
  error: null,
  notice: null,
  busyItems: [],
  cafeteriaBusy: false,
  itemErrors: {},
  cafeteriaError: null,
});
const safeError = (cause: unknown) =>
  cause instanceof AvailabilityApiError ? cause : new AvailabilityApiError(503);

/** Optimistic values are a temporary overlay; only acknowledgements and GET update confirmed data. */
export class AvailabilityStore {
  private state = initial();
  private confirmed: TodayAvailability | null = null;
  private optimistic = new Map<string, boolean>();
  private listeners = new Set<() => void>();
  private pending = new Set<string>();
  private active = true;
  private lifecycle = 0;
  private needsSync = false;
  private dayExpired = false;
  private read: {
    version: number;
    controller: AbortController;
    promise: Promise<void>;
  } | null = null;
  private readVersion = 0;

  constructor(private readonly api: AvailabilityApi) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<AvailabilityState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch, data: this.visibleData() };
    this.listeners.forEach((listener) => listener());
  }
  private visibleData(): TodayAvailability | null {
    if (!this.confirmed || !this.optimistic.size) return this.confirmed;
    return {
      ...this.confirmed,
      cafeteria: {
        ...this.confirmed.cafeteria,
        open: this.optimistic.get("cafeteria") ?? this.confirmed.cafeteria.open,
      },
      categories: this.confirmed.categories.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          available: this.optimistic.get(item.id) ?? item.available,
        })),
      })),
    };
  }
  start() {
    this.active = true;
    return this.refresh();
  }
  dispose() {
    this.active = false;
    this.lifecycle++;
    this.readVersion++;
    this.read?.controller.abort();
    this.read = null;
    this.pending.clear();
    this.optimistic.clear();
    this.needsSync = false;
    this.state = {
      ...this.state,
      data: this.confirmed,
      busyItems: [],
      cafeteriaBusy: false,
      refreshing: false,
    };
  }
  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    if (this.pending.size) {
      this.needsSync = true;
      this.publish({ refreshing: true });
      return Promise.resolve();
    }
    if (this.read) return this.read.promise;
    const version = ++this.readVersion;
    const life = this.lifecycle;
    const controller = new AbortController();
    this.publish({
      loading: this.state.data === null,
      refreshing: this.state.data !== null,
      error: null,
    });
    // Defer execution so the in-flight reference exists even for a synchronous test transport.
    const promise = Promise.resolve().then(async () => {
      try {
        const data = await this.api.today(controller.signal);
        if (
          !this.active ||
          life !== this.lifecycle ||
          version !== this.readVersion
        )
          return;
        this.needsSync = false;
        this.confirmed = data;
        const notice = this.dayExpired
          ? "El día de operación cambió. Actualizamos la disponibilidad."
          : this.state.notice;
        this.publish({
          loading: false,
          refreshing: false,
          error: null,
          notice,
          ...(this.dayExpired ? { itemErrors: {}, cafeteriaError: null } : {}),
        });
        this.dayExpired = false;
      } catch (cause) {
        if (
          !this.active ||
          life !== this.lifecycle ||
          version !== this.readVersion
        )
          return;
        // A failed read cannot turn absence of data into an apparent confirmed false.
        this.publish({
          loading: false,
          refreshing: false,
          error: safeError(cause).message,
        });
      } finally {
        if (this.read?.version === version) this.read = null;
      }
    });
    this.read = { version, controller, promise };
    return promise;
  };

  setItem = (itemId: string, available: boolean) =>
    this.mutate(itemId, available);
  setCafeteria = (open: boolean) => this.mutate("cafeteria", open);
  private async mutate(key: string, value: boolean): Promise<void> {
    const data = this.confirmed;
    if (
      !this.active ||
      !data ||
      this.state.loading ||
      this.state.refreshing ||
      this.state.error ||
      this.pending.has(key)
    )
      return;
    const item =
      key === "cafeteria"
        ? null
        : data.categories
            .flatMap((group) => group.items)
            .find((entry) => entry.id === key);
    if (key !== "cafeteria" && !item) return;
    if (value && !data.cafeteria.active) return;
    const life = this.lifecycle;
    this.pending.add(key);
    this.optimistic.set(key, value);
    const errors = { ...this.state.itemErrors };
    delete errors[key];
    this.publish({
      busyItems: [...this.pending].filter((id) => id !== "cafeteria"),
      cafeteriaBusy: this.pending.has("cafeteria"),
      itemErrors: errors,
      ...(key === "cafeteria" ? { cafeteriaError: null } : {}),
      notice: null,
    });
    try {
      if (key === "cafeteria") {
        const response = await this.api.cafeteria(data.businessDate, value);
        if (
          !this.active ||
          life !== this.lifecycle ||
          this.dayExpired ||
          this.confirmed?.businessDate !== response.businessDate
        )
          return;
        this.confirmed = {
          ...this.confirmed,
          cafeteria: { ...this.confirmed.cafeteria, open: response.open },
        };
      } else {
        const response = await this.api.item(key, data.businessDate, value);
        if (
          !this.active ||
          life !== this.lifecycle ||
          this.dayExpired ||
          this.confirmed?.businessDate !== response.businessDate
        )
          return;
        this.confirmed = {
          ...this.confirmed,
          categories: this.confirmed.categories.map((group) => ({
            ...group,
            items: group.items.map((entry) =>
              entry.id === key
                ? { ...entry, available: response.available }
                : entry,
            ),
          })),
        };
      }
    } catch (cause) {
      if (!this.active || life !== this.lifecycle) return;
      const error = safeError(cause);
      this.optimistic.delete(key);
      if (error.code === "AVAILABILITY_DAY_EXPIRED") this.dayExpired = true;
      this.needsSync = true;
      this.publish({
        notice: error.message,
        refreshing: true,
        ...(key === "cafeteria"
          ? { cafeteriaError: error.message }
          : { itemErrors: { ...this.state.itemErrors, [key]: error.message } }),
      });
    } finally {
      if (this.active && life === this.lifecycle) {
        this.pending.delete(key);
        this.optimistic.delete(key);
        this.publish({
          busyItems: [...this.pending].filter((id) => id !== "cafeteria"),
          cafeteriaBusy: this.pending.has("cafeteria"),
        });
        if (this.needsSync && !this.pending.size) await this.refresh();
      }
    }
  }
}
