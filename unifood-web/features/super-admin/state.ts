import type { SuperAdminApi } from "./api";
import { SuperAdminError } from "./errors";
import { SAVED } from "./presentation";
import type {
  BillingValue,
  CafeteriaAuditEntry,
  SuperAdminCafeteria,
  SuperAdminCafeterias,
} from "./types";

export type SettingsControl = "visibility" | "billing";

export type SuperAdminState = {
  data: SuperAdminCafeterias | null;
  loading: boolean;
  error: { status: number; message: string } | null;
  /** The cafeteria whose settings are open. */
  selected: string | null;
  saving: SettingsControl | null;
  /** Shown next to the control that failed. */
  controlError: { control: SettingsControl; message: string } | null;
  /** Announced in an aria-live region. */
  notice: string | null;
  audit: {
    cafeteriaId: string;
    entries: CafeteriaAuditEntry[] | null;
    loading: boolean;
    error: string | null;
  } | null;
};

const CONFLICTS = ["VISIBILITY_STATE_CHANGED", "BILLING_STATE_CHANGED"];

function replace(
  data: SuperAdminCafeterias,
  cafeteria: SuperAdminCafeteria,
): SuperAdminCafeterias {
  return {
    institutions: data.institutions.map((institution) => ({
      ...institution,
      sites: institution.sites.map((site) => ({
        ...site,
        cafeterias: site.cafeterias.map((current) =>
          current.id === cafeteria.id ? cafeteria : current,
        ),
      })),
    })),
  };
}

export function findCafeteria(
  data: SuperAdminCafeterias | null,
  id: string | null,
) {
  if (!data || !id) return null;
  for (const institution of data.institutions)
    for (const site of institution.sites)
      for (const cafeteria of site.cafeterias)
        if (cafeteria.id === id) return cafeteria;
  return null;
}

/** One listing request at a time, explicit retry, no polling; one save at a time. */
export class SuperAdminStore {
  private state: SuperAdminState = {
    data: null,
    loading: true,
    error: null,
    selected: null,
    saving: null,
    controlError: null,
    notice: null,
    audit: null,
  };
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private auditRequest: AbortController | null = null;

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

  /** A denied session must not keep showing anything it read before. */
  private denied(error: SuperAdminError) {
    if (error.status !== 401 && error.status !== 403) return false;
    this.auditRequest?.abort();
    this.update({
      data: null,
      selected: null,
      audit: null,
      saving: null,
      controlError: null,
      notice: null,
      error: { status: error.status, message: error.message },
    });
    return true;
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
      if (!this.denied(error))
        this.update({
          error: { status: error.status, message: error.message },
        });
    } finally {
      if (this.active === controller) {
        this.active = null;
        this.update({ loading: false });
      }
    }
  };

  select = (id: string | null) => {
    if (this.state.saving) return;
    this.update({ selected: id, controlError: null, notice: null });
    if (id) void this.loadAudit(id);
    else {
      this.auditRequest?.abort();
      this.update({ audit: null });
    }
  };

  loadAudit = async (cafeteriaId: string) => {
    this.auditRequest?.abort();
    const controller = new AbortController();
    this.auditRequest = controller;
    this.update({
      audit: { cafeteriaId, entries: null, loading: true, error: null },
    });
    try {
      const { entries } = await this.api.audit(cafeteriaId, controller.signal);
      if (this.auditRequest === controller)
        this.update({
          audit: { cafeteriaId, entries, loading: false, error: null },
        });
    } catch (cause) {
      if (this.auditRequest !== controller) return;
      const error =
        cause instanceof SuperAdminError
          ? cause
          : new SuperAdminError(503, undefined, "audit");
      if (!this.denied(error))
        this.update({
          audit: {
            cafeteriaId,
            entries: null,
            loading: false,
            error: error.message,
          },
        });
    } finally {
      if (this.auditRequest === controller) this.auditRequest = null;
    }
  };

  private async save(
    control: SettingsControl,
    cafeteriaId: string,
    request: () => Promise<SuperAdminCafeteria>,
  ) {
    if (this.state.saving) return false;
    this.update({ saving: control, controlError: null, notice: null });
    try {
      const cafeteria = await request();
      this.update({
        data: this.state.data ? replace(this.state.data, cafeteria) : null,
        notice: SAVED,
      });
      void this.loadAudit(cafeteriaId);
      return true;
    } catch (cause) {
      const error =
        cause instanceof SuperAdminError
          ? cause
          : new SuperAdminError(503, undefined, "save");
      if (this.denied(error)) return false;
      this.update({ controlError: { control, message: error.message } });
      // Someone else changed it: show the current value so the retry starts from it.
      if (CONFLICTS.includes(error.code)) void this.load();
      return false;
    } finally {
      this.update({ saving: null });
    }
  }

  setVisibility = (cafeteriaId: string, visible: boolean) => {
    const current = findCafeteria(this.state.data, cafeteriaId);
    if (!current) return Promise.resolve(false);
    return this.save("visibility", cafeteriaId, () =>
      this.api.visibility(cafeteriaId, {
        visible,
        expectedVisible: current.visible,
      }),
    );
  };

  /** Fails next to the control when visibility needs an ADMIN, without calling Spring. */
  refuse = (control: SettingsControl, message: string) =>
    this.update({ controlError: { control, message }, notice: null });

  setBilling = (cafeteriaId: string, billing: BillingValue) => {
    const current = findCafeteria(this.state.data, cafeteriaId);
    if (!current) return Promise.resolve(false);
    return this.save("billing", cafeteriaId, () =>
      this.api.billing(cafeteriaId, {
        ...billing,
        expectedVersion: current.billing.version,
      }),
    );
  };

  dispose = () => {
    this.active?.abort();
    this.active = null;
    this.auditRequest?.abort();
    this.auditRequest = null;
  };
}
