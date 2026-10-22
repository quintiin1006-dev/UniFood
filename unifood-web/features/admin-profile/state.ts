import { AdminProfileError } from "./errors";
import type { AdminProfileApi } from "./api";
import type { AdminProfile } from "./types";

type State = {
  data: AdminProfile | null;
  loading: boolean;
  error: { status: number; message: string } | null;
};

/** One current context for the whole ADMIN shell, including its inactive banner. */
export class AdminProfileStore {
  private state: State = { data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  constructor(private readonly api: AdminProfileApi) {}
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
        cause instanceof AdminProfileError ? cause : new AdminProfileError(503);
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
