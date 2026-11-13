export type BillingModel = "NONE" | "SUBSCRIPTION" | "PER_ORDER_FEE";

/** Recorded agreement only: UniFood charges nothing from the app (decisiones §5). */
export type CafeteriaBilling = {
  model: BillingModel;
  /** Whole pesos; only with PER_ORDER_FEE. */
  perOrderFeeCop: number | null;
  /** Whole pesos, optional; only with SUBSCRIPTION. */
  subscriptionFeeCop: number | null;
  version: number;
};

export type SuperAdminCafeteria = {
  id: string;
  name: string;
  /** `cafeterias.is_active`: visible to clients and accepting new orders. */
  visible: boolean;
  hasActiveAdmin: boolean;
  billing: CafeteriaBilling;
};

export type SuperAdminSite = {
  id: string;
  name: string;
  city: string;
  active: boolean;
  cafeterias: SuperAdminCafeteria[];
};

export type SuperAdminInstitution = {
  id: string;
  name: string;
  active: boolean;
  sites: SuperAdminSite[];
};

export type SuperAdminCafeterias = { institutions: SuperAdminInstitution[] };

export type VisibilityValue = { visible: boolean };
export type BillingValue = Omit<CafeteriaBilling, "version">;

export type CafeteriaAuditEntry =
  | {
      setting: "VISIBILITY";
      oldValue: VisibilityValue;
      newValue: VisibilityValue;
      changedAt: string;
      changedBy: { name: string } | null;
      source: "API" | "SQL";
    }
  | {
      setting: "BILLING";
      /** null for the row created with the cafeteria. */
      oldValue: BillingValue | null;
      newValue: BillingValue;
      changedAt: string;
      changedBy: { name: string } | null;
      source: "API" | "SQL";
    };

export type CafeteriaAudit = { entries: CafeteriaAuditEntry[] };

export type VisibilityCommand = { visible: boolean; expectedVisible: boolean };
export type BillingCommand = {
  model: BillingModel;
  perOrderFeeCop: number | null;
  subscriptionFeeCop: number | null;
  expectedVersion: number;
};
