import type { WorkerHistoryApi } from "./api";
import { WorkerHistoryError } from "./errors";
import type { TodayWorkerHistory } from "./types";

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
  data: TodayWorkerHistory | null;
  loading: boolean;
  refreshing: boolean;
  error: { status: number; message: string } | null;
};

export class WorkerHistoryStore {
  private state: HistoryState = {
    query: "",
    data: null,
    loading: true,
    refreshing: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private runtime: HistoryRuntime | null = null;
  private poll?: number;
  private deadline?: number;
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
  setQuery = (query: string) => {
    this.update({ query });
  };
  private denied() {
    return this.state.error?.status === 401 || this.state.error?.status === 403;
  }
  private clearTimers() {
    if (this.poll !== undefined) this.runtime?.cancel(this.poll);
    if (this.deadline !== undefined) this.runtime?.cancel(this.deadline);
    this.poll = this.deadline = undefined;
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
    // A skewed browser clock or an old response must not create a hot retry loop.
    const delay = remaining > 0 ? Math.min(remaining, 2_147_483_647) : 30000;
    this.deadline = this.runtime.later(() => {
      this.deadline = undefined;
      void this.refresh();
    }, delay);
  }
  start(runtime: HistoryRuntime) {
    this.dispose();
    this.runtime = runtime;
    const resume = () => {
      this.clearTimers();
      if (!runtime.visible() || this.denied()) return;
      this.schedulePoll();
      this.scheduleDeadline();
      void this.refresh();
    };
    this.unsubscribe = [
      runtime.onFocus(() => {
        if (runtime.visible() && !this.denied()) void this.refresh();
      }),
      runtime.onVisibility(resume),
    ];
    resume();
  }
  refresh = async () => {
    if (!this.runtime?.visible() || this.active) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.active = controller;
    this.update({ loading: !this.state.data, refreshing: !!this.state.data });
    try {
      const data = await this.api.today(controller.signal);
      if (generation !== this.generation || this.active !== controller) return;
      // Always replace the complete snapshot, including an empty new business day.
      this.update({ data, error: null });
    } catch (cause) {
      if (generation !== this.generation || this.active !== controller) return;
      const error =
        cause instanceof WorkerHistoryError
          ? cause
          : new WorkerHistoryError(503);
      this.update({
        error: { status: error.status, message: error.message },
        ...(error.status === 401 || error.status === 403 ? { data: null } : {}),
      });
      if (this.denied()) this.clearTimers();
    } finally {
      if (generation === this.generation && this.active === controller) {
        this.active = null;
        this.update({ loading: false, refreshing: false });
        this.scheduleDeadline();
      }
    }
  };
  dispose = () => {
    ++this.generation;
    this.clearTimers();
    this.unsubscribe.forEach((remove) => remove());
    this.unsubscribe = [];
    this.active?.abort();
    this.active = null;
    this.runtime = null;
  };
}
