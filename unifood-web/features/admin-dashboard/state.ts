import { adminDashboardApi } from "./api";
import { AdminDashboardError } from "./errors";
import type { AdminDashboardData, DashboardFilters } from "./types";

type State = {
  filters: DashboardFilters;
  data: AdminDashboardData | null;
  loading: boolean;
  error: { status: number; message: string } | null;
  referenceAsOf: string | null;
};
export class AdminDashboardStore {
  private state: State = {
    filters: { range: "TODAY", rankingLimit: 10 },
    data: null,
    loading: true,
    error: null,
    referenceAsOf: null,
  };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  constructor(
    private readonly api: Pick<
      typeof adminDashboardApi,
      "get"
    > = adminDashboardApi,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: State) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  load = async (filters: DashboardFilters = this.state.filters) => {
    if (this.state.error && [401, 403].includes(this.state.error.status))
      return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({
      ...this.state,
      filters: { ...filters, rankingLimit: 10 },
      data: null,
      loading: true,
      error: null,
    });
    try {
      const data = await this.api.get(this.state.filters, request.signal);
      if (this.request === request)
        this.publish({
          ...this.state,
          data,
          loading: false,
          error: null,
          referenceAsOf: data.period.asOf,
        });
    } catch (cause) {
      if (this.request !== request) return;
      const error =
        cause instanceof AdminDashboardError
          ? cause
          : new AdminDashboardError(503);
      this.publish({
        ...this.state,
        data: null,
        loading: false,
        error: { status: error.status, message: error.message },
        referenceAsOf: [401, 403].includes(error.status)
          ? null
          : this.state.referenceAsOf,
      });
    } finally {
      if (this.request === request) this.request = null;
    }
  };
  dispose = () => {
    this.request?.abort();
    this.request = null;
  };
}
