import type { WorkerProfileApi } from "./api";
import { WorkerProfileError } from "./errors";
import type { WorkerProfile } from "./types";

type ProfileState = {
  data: WorkerProfile | null;
  loading: boolean;
  error: { status: number; message: string } | null;
};
export class WorkerProfileStore {
  private state: ProfileState = { data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private disposed = false;
  constructor(private readonly api: WorkerProfileApi) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: ProfileState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  start = () => {
    this.disposed = false;
    void this.refresh();
  };
  refresh = async () => {
    if (this.disposed || this.active) return;
    const controller = new AbortController();
    this.active = controller;
    // A complete profile is displayed only after a successful current response.
    this.update({ data: null, loading: true, error: null });
    try {
      const data = await this.api.get(controller.signal);
      if (this.disposed || this.active !== controller) return;
      this.update({ data, loading: false, error: null });
    } catch (cause) {
      if (this.disposed || this.active !== controller) return;
      const error =
        cause instanceof WorkerProfileError
          ? cause
          : new WorkerProfileError(503);
      this.update({
        data: null,
        loading: false,
        error: { status: error.status, message: error.message },
      });
    } finally {
      if (this.active === controller) this.active = null;
    }
  };
  dispose = () => {
    this.disposed = true;
    this.active?.abort();
    this.active = null;
  };
}
