import { AdminCatalogError } from "./errors";
import type { AdminCatalogApi } from "./api";
import type { AdminCatalogData, AdminProduct } from "./types";

type State = {
  data: AdminCatalogData | null;
  loading: boolean;
  error: { status: number; message: string } | null;
};
export class AdminCatalogStore {
  private state: State = { data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private authorizationRevision = 0;
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
    this.publish({ data: this.state.data, loading: true, error: null });
    try {
      const data = await this.api.get(request.signal);
      if (this.request === request)
        this.publish({ data, loading: false, error: null });
    } catch (cause) {
      if (this.request !== request) return;
      const error =
        cause instanceof AdminCatalogError ? cause : new AdminCatalogError(503);
      if ([401, 403].includes(error.status)) this.authorizationRevision++;
      this.publish({
        data: [401, 403].includes(error.status) ? null : this.state.data,
        loading: false,
        error: { status: error.status, message: error.message },
      });
    } finally {
      if (this.request === request) this.request = null;
    }
  };
  invalidateReads = () => {
    this.request?.abort();
    this.request = null;
    this.publish({ ...this.state, loading: false });
    return this.authorizationRevision;
  };
  denyAccess = (status: number) => {
    this.authorizationRevision++;
    this.invalidateReads();
    const error = new AdminCatalogError(status);
    this.publish({
      data: null,
      loading: false,
      error: { status, message: error.message },
    });
  };
  applyConfirmed = (
    product: AdminProduct,
    authorizationRevision = this.authorizationRevision,
  ) => {
    // An acknowledgement admitted before a definitive denial cannot restore the
    // previous protected context, even after a later authorized GET has recovered.
    if (authorizationRevision !== this.authorizationRevision) return;
    this.invalidateReads();
    const previous = this.state.data?.products ?? [];
    const existing = previous.find((p) => p.id === product.id);
    if (existing && BigInt(existing.version) > BigInt(product.version)) return;
    const products = [
      ...previous.filter((p) => p.id !== product.id),
      product,
    ].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.id.localeCompare(b.id),
    );
    this.publish({ data: { products }, loading: false, error: null });
  };
  dispose = () => {
    this.request?.abort();
    this.request = null;
  };
}
