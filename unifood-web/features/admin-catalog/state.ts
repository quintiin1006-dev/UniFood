import { AdminCatalogError } from "./errors";
import type { AdminCatalogApi } from "./api";
import type { AdminCatalogData } from "./types";

type State = {
  data: AdminCatalogData | null;
  loading: boolean;
  error: { status: number; message: string } | null;
};
export class AdminCatalogStore {
  private state: State = { data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  constructor(private readonly api: AdminCatalogApi) {}
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
  refresh = async () => {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ data: null, loading: true, error: null });
    try {
      const data = await this.api.get(request.signal);
      if (this.request === request)
        this.publish({ data, loading: false, error: null });
    } catch (cause) {
      if (this.request !== request) return;
      const error =
        cause instanceof AdminCatalogError ? cause : new AdminCatalogError(503);
      this.publish({
        data: null,
        loading: false,
        error: { status: error.status, message: error.message },
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
