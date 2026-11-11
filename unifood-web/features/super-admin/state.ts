import type { SuperAdminApi } from "./api";
import { SuperAdminError } from "./errors";
import type { SuperAdminCafeterias } from "./types";

export type SuperAdminState = {
  data: SuperAdminCafeterias | null;
  loading: boolean;
  error: { status: number; message: string } | null;
};

/** Read-only listing: one request at a time, explicit retry, no polling. */
export class SuperAdminStore {
  private state: SuperAdminState = { data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;

  constructor(private readonly api: SuperAdminApi) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<SuperAdminState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  load = async () => {
    if (this.active) return;
    const controller = new AbortController();
    this.active = controller;
    this.update({ loading: true, error: null });
    try {
      const data = await this.api.cafeterias(controller.signal);
      if (this.active === controller) this.update({ data, error: null });
    } catch (cause) {
      if (this.active !== controller) return;
      const error =
        cause instanceof SuperAdminError ? cause : new SuperAdminError(503);
      this.update({
        // A denied session must not keep showing the previous listing.
        ...(error.status === 401 || error.status === 403 ? { data: null } : {}),
        error: { status: error.status, message: error.message },
      });
    } finally {
      if (this.active === controller) {
        this.active = null;
        this.update({ loading: false });
      }
    }
  };

  dispose = () => {
    this.active?.abort();
    this.active = null;
  };
}
