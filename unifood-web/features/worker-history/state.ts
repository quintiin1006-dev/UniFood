import type { WorkerHistoryApi } from "./api";
import { WorkerHistoryError } from "./errors";
import type { HistoryRange, HistoryStatus, WorkerHistoryPage } from "./types";

export type HistoryRuntime = {
  now(): number;
  visible(): boolean;
  later(callback: () => void, delay: number): number;
  cancel(timer: number): void;
  onFocus(callback: () => void): () => void;
  onVisibility(callback: () => void): () => void;
};
type HistoryState = {
  query: string;
  range: HistoryRange;
  status: HistoryStatus | "";
  data: WorkerHistoryPage | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: { status: number; message: string } | null;
};

export class WorkerHistoryStore {
  private state: HistoryState = {
    query: "",
    range: "MONTH",
    status: "",
    data: null,
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private runtime: HistoryRuntime | null = null;
  private poll?: number;
  private deadline?: number;
  private debounce?: number;
  private unsubscribe: (() => void)[] = [];
  private generation = 0;
  private active: AbortController | null = null;

  constructor(private readonly api: WorkerHistoryApi) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<HistoryState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private denied() {
    return this.state.error?.status === 401 || this.state.error?.status === 403;
  }
  private invalidate() {
    ++this.generation;
    this.active?.abort();
    this.active = null;
  }
  private clearTimers() {
    for (const timer of [this.poll, this.deadline, this.debounce])
      if (timer !== undefined) this.runtime?.cancel(timer);
    this.poll = this.deadline = this.debounce = undefined;
  }
  private criteriaChanged(patch: Partial<HistoryState>, delay: number) {
    this.invalidate();
    if (this.debounce !== undefined) this.runtime?.cancel(this.debounce);
    this.debounce = undefined;
    if (this.deadline !== undefined) this.runtime?.cancel(this.deadline);
    this.deadline = undefined;
    this.update({
      ...patch,
      data: null,
      error: null,
      loading: true,
      refreshing: false,
      loadingMore: false,
    });
    if (!this.runtime?.visible()) return;
    if (!delay) {
      void this.refresh();
      return;
    }
    this.debounce = this.runtime.later(() => {
      this.debounce = undefined;
      void this.refresh();
    }, delay);
  }
  setQuery = (query: string) => {
    if (query !== this.state.query)
      this.criteriaChanged({ query }, query ? 300 : 0);
  };
  setRange = (range: HistoryRange) => {
    if (range !== this.state.range) this.criteriaChanged({ range }, 0);
  };
  setStatus = (status: HistoryStatus | "") => {
    if (status !== this.state.status) this.criteriaChanged({ status }, 0);
  };
  clearFilters = () =>
    this.criteriaChanged({ query: "", range: "MONTH", status: "" }, 0);
  private expire() {
    if (
      !this.runtime ||
      !this.state.data ||
      Date.parse(this.state.data.nextBusinessDateAt) > this.runtime.now()
    )
      return;
    // Backend deadline, not a browser-selected business date. Hide before refetch.
    this.invalidate();
    this.update({
      data: null,
      loading: true,
      refreshing: false,
      loadingMore: false,
      error: null,
    });
  }
  private schedulePoll() {
    if (!this.runtime?.visible() || this.denied()) return;
    this.poll = this.runtime.later(() => {
      this.poll = undefined;
      void this.refresh();
      this.schedulePoll();
    }, 30000);
  }
  private scheduleDeadline() {
    if (this.deadline !== undefined) this.runtime?.cancel(this.deadline);
    this.deadline = undefined;
    if (!this.runtime?.visible() || !this.state.data || this.denied()) return;
    const remaining =
      Date.parse(this.state.data.nextBusinessDateAt) - this.runtime.now();
    this.deadline = this.runtime.later(
      () => {
        this.deadline = undefined;
        this.expire();
        void this.refresh();
      },
      remaining > 0 ? Math.min(remaining, 2_147_483_647) : 30000,
    );
  }
  start(runtime: HistoryRuntime) {
    this.dispose();
    this.runtime = runtime;
    const resume = () => {
      this.clearTimers();
      if (!runtime.visible() || this.denied()) return;
      this.expire();
      this.schedulePoll();
      this.scheduleDeadline();
      void this.refresh();
    };
    this.unsubscribe = [
      runtime.onFocus(() => {
        if (runtime.visible() && !this.denied()) {
          this.expire();
          void this.refresh();
        }
      }),
      runtime.onVisibility(resume),
    ];
    resume();
  }
  refresh = async () => {
    this.expire();
    if (
      !this.runtime?.visible() ||
      this.active ||
      this.debounce !== undefined ||
      this.denied()
    )
      return;
    await this.read(false);
  };
  loadMore = async () => {
    this.expire();
    if (
      !this.runtime?.visible() ||
      this.active ||
      this.denied() ||
      !this.state.data?.nextCursor
    )
      return;
    await this.read(true);
  };
  private async read(append: boolean) {
    const generation = this.generation;
    const controller = new AbortController();
    this.active = controller;
    const cursor = append
      ? (this.state.data?.nextCursor ?? undefined)
      : undefined;
    this.update({
      loading: !this.state.data,
      refreshing: !!this.state.data && !append,
      loadingMore: append,
    });
    let restart = false;
    try {
      const data = await this.api.page(
        {
          q: this.state.query,
          range: this.state.range,
          status: this.state.status || undefined,
          cursor,
        },
        controller.signal,
      );
      if (generation !== this.generation || this.active !== controller) return;
      if (
        this.runtime &&
        Date.parse(data.nextBusinessDateAt) <= this.runtime.now()
      ) {
        // A stale server response cannot repopulate an expired month/day.
        this.update({
          data: null,
          error: {
            status: 503,
            message:
              "El historial está cambiando de fecha. Inténtalo nuevamente.",
          },
        });
        return;
      }
      if (append && this.state.data) {
        if (
          data.businessDate !== this.state.data.businessDate ||
          data.monthStart !== this.state.data.monthStart
        ) {
          this.update({ data: null, error: null });
          restart = true;
          return;
        }
        const ids = new Set(this.state.data.orders.map((order) => order.id));
        this.update({
          data: {
            ...data,
            orders: [
              ...this.state.data.orders,
              ...data.orders.filter((order) => !ids.has(order.id)),
            ],
          },
          error: null,
        });
      } else this.update({ data, error: null });
    } catch (cause) {
      if (generation !== this.generation || this.active !== controller) return;
      const error =
        cause instanceof WorkerHistoryError
          ? cause
          : new WorkerHistoryError(503);
      if (append && error.status === 400) {
        this.update({ data: null, error: null });
        restart = true;
      } else {
        this.update({
          error: { status: error.status, message: error.message },
          ...(error.status === 401 || error.status === 403
            ? { data: null }
            : {}),
        });
        if (this.denied()) this.clearTimers();
      }
    } finally {
      if (generation === this.generation && this.active === controller) {
        this.active = null;
        this.update({ loading: false, refreshing: false, loadingMore: false });
        this.scheduleDeadline();
        if (restart) void this.refresh();
      }
    }
  }
  dispose = () => {
    this.invalidate();
    this.clearTimers();
    this.unsubscribe.forEach((remove) => remove());
    this.unsubscribe = [];
    this.runtime = null;
  };
}
