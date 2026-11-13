import { adminDashboardApi } from "./api";
import { DashboardCache, dashboardCache } from "./cache";
import { AdminDashboardError } from "./errors";
import { bogotaDate } from "./filters";
import type { AdminDashboardData, DashboardFilters } from "./types";

export const DASHBOARD_REFRESH_FAILED =
  "No pudimos actualizar el dashboard. Se muestran los datos anteriores.";

type State = {
  filters: DashboardFilters;
  data: AdminDashboardData | null;
  loading: boolean;
  error: { status: number; message: string } | null;
  /** A failed «Actualizar» that kept the previous data on screen. */
  refreshError: string | null;
  referenceAsOf: string | null;
  /** The server instant the data on screen was computed at (`period.asOf`). */
  updatedAt: string | null;
};

/**
 * An occasional analysis screen: it loads once when opened and whenever the period changes,
 * and «Actualizar» forces a fresh query. There is no polling and no reload on focus.
 */
export class AdminDashboardStore {
  private state: State = {
    filters: { range: "TODAY", rankingLimit: 10 },
    data: null,
    loading: true,
    error: null,
    refreshError: null,
    referenceAsOf: null,
    updatedAt: null,
  };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  constructor(
    private readonly api: Pick<
      typeof adminDashboardApi,
      "get"
    > = adminDashboardApi,
    private readonly cache: DashboardCache = dashboardCache,
    private readonly now: () => Date = () => new Date(),
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
  private denied() {
    return !!this.state.error && [401, 403].includes(this.state.error.status);
  }
  /** Opening the screen or changing the period. A closed past period may come from the cache. */
  load = async (filters: DashboardFilters = this.state.filters) => {
    if (this.denied()) return;
    const next = { ...filters, rankingLimit: 10 };
    const cached = this.cache.get(next, bogotaDate(this.now()));
    if (cached) {
      this.request?.abort();
      this.request = null;
      this.publish({
        ...this.state,
        filters: next,
        data: cached,
        loading: false,
        error: null,
        refreshError: null,
        referenceAsOf: cached.period.asOf,
        updatedAt: cached.period.asOf,
      });
      return;
    }
    // Another period: the previous numbers would be misleading, so they are withdrawn.
    await this.fetch(next, false);
  };
  /** «Actualizar»: always a fresh query; on a failure the previous data stays on screen. */
  refresh = async () => {
    if (this.denied() || this.state.loading) return;
    await this.fetch(this.state.filters, !!this.state.data);
  };
  private async fetch(filters: DashboardFilters, keep: boolean) {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({
      ...this.state,
      filters,
      data: keep ? this.state.data : null,
      updatedAt: keep ? this.state.updatedAt : null,
      loading: true,
      error: null,
      refreshError: null,
    });
    try {
      const data = await this.api.get(filters, request.signal);
      if (this.request !== request) return;
      this.cache.set(filters, data, bogotaDate(this.now()));
      this.publish({
        ...this.state,
        data,
        loading: false,
        error: null,
        refreshError: null,
        referenceAsOf: data.period.asOf,
        updatedAt: data.period.asOf,
      });
    } catch (cause) {
      if (this.request !== request) return;
      const error =
        cause instanceof AdminDashboardError
          ? cause
          : new AdminDashboardError(503);
      const denial = [401, 403].includes(error.status);
      if (denial) this.cache.clear();
      if (keep && !denial) {
        this.publish({
          ...this.state,
          loading: false,
          refreshError: DASHBOARD_REFRESH_FAILED,
        });
        return;
      }
      this.publish({
        ...this.state,
        data: null,
        updatedAt: null,
        loading: false,
        error: { status: error.status, message: error.message },
        refreshError: null,
        referenceAsOf: denial ? null : this.state.referenceAsOf,
      });
    } finally {
      if (this.request === request) this.request = null;
    }
  }
  dispose = () => {
    this.request?.abort();
    this.request = null;
  };
}
