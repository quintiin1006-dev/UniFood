import { MAX_PER_ORDER_FEE_COP, MAX_SUBSCRIPTION_FEE_COP } from "./contracts";
import type {
  BillingModel,
  BillingValue,
  CafeteriaAuditEntry,
  CafeteriaBilling,
  SuperAdminCafeterias,
} from "./types";

export type CafeteriaRow = {
  id: string;
  name: string;
  institution: string;
  institutionActive: boolean;
  site: string;
  city: string;
  siteActive: boolean;
  visible: boolean;
  hasActiveAdmin: boolean;
  billing: CafeteriaBilling;
};

/** Flattens the tree in the server's order, one row per cafeteria. */
export function cafeteriaRows(data: SuperAdminCafeterias): CafeteriaRow[] {
  return data.institutions.flatMap((institution) =>
    institution.sites.flatMap((site) =>
      site.cafeterias.map((cafeteria) => ({
        id: cafeteria.id,
        name: cafeteria.name,
        institution: institution.name,
        institutionActive: institution.active,
        site: site.name,
        city: site.city,
        siteActive: site.active,
        visible: cafeteria.visible,
        hasActiveAdmin: cafeteria.hasActiveAdmin,
        billing: cafeteria.billing,
      })),
    ),
  );
}

export function summary(data: SuperAdminCafeterias) {
  const rows = cafeteriaRows(data);
  const sites = data.institutions.reduce(
    (total, institution) => total + institution.sites.length,
    0,
  );
  return {
    institutions: data.institutions.length,
    sites,
    cafeterias: rows.length,
    visible: rows.filter((row) => row.visible).length,
  };
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** SA1: «1 cafetería en 1 sede de 1 institución · 1 visible para los clientes.» */
export function summaryText(totals: ReturnType<typeof summary>) {
  return (
    `${count(totals.cafeterias, "cafetería", "cafeterías")} en ` +
    `${count(totals.sites, "sede", "sedes")} de ` +
    `${count(totals.institutions, "institución", "instituciones")} · ` +
    `${count(totals.visible, "visible", "visibles")} para los clientes.`
  );
}

export const visibilityLabel = (visible: boolean) =>
  visible ? "Visible" : "Oculta";
/** SA2: the role's code never reaches the screen. */
export const adminLabel = (hasActiveAdmin: boolean) =>
  hasActiveAdmin ? "Asignado" : "Sin administrador activo";

export const MODEL_LABELS: Record<BillingModel, string> = {
  NONE: "Sin cobro",
  SUBSCRIPTION: "Suscripción",
  PER_ORDER_FEE: "Comisión por pedido",
};

export const pesos = (amount: number) =>
  `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount)}`;

export function billingLabel(billing: BillingValue) {
  if (billing.model === "PER_ORDER_FEE" && billing.perOrderFeeCop !== null)
    return `Comisión de ${pesos(billing.perOrderFeeCop)} por pedido`;
  if (billing.model === "SUBSCRIPTION")
    return billing.subscriptionFeeCop === null
      ? "Suscripción"
      : `Suscripción de ${pesos(billing.subscriptionFeeCop)} al mes`;
  return "Sin cobro";
}

export const BILLING_NOTE =
  "UniFood no cobra desde la aplicación; esto solo registra el acuerdo.";
export const HIDE_CONFIRMATION =
  "Los pedidos en curso se terminarán de atender. Los clientes no podrán hacer pedidos nuevos en esta cafetería.";
export const SAVED = "Cambios guardados.";
export const REQUIRES_ADMIN =
  "Asigna un administrador activo antes de hacer visible esta cafetería.";
export const FEE_INVALID = "Escribe una comisión entera entre $1 y $1.000.000.";
export const MONTHLY_INVALID =
  "Escribe un monto mensual entero entre $1 y $100.000.000, o déjalo vacío.";

/** Whole pesos as people type them: «1000», «1.000» or «$ 1.000». Null if it is not one. */
export function parsePesos(input: string): number | null {
  const text = input.trim().replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return null;
  const value = Number(text.replaceAll(".", ""));
  return Number.isSafeInteger(value) ? value : null;
}

export type BillingDraft = {
  model: BillingModel;
  perOrderFee: string;
  subscriptionFee: string;
};

export function billingDraft(billing: CafeteriaBilling): BillingDraft {
  return {
    model: billing.model,
    perOrderFee:
      billing.perOrderFeeCop === null ? "" : String(billing.perOrderFeeCop),
    subscriptionFee:
      billing.subscriptionFeeCop === null
        ? ""
        : String(billing.subscriptionFeeCop),
  };
}

/** The agreement the form describes, or the fixed message of its first problem. */
export function draftBilling(
  draft: BillingDraft,
): { billing: BillingValue } | { error: string } {
  if (draft.model === "PER_ORDER_FEE") {
    const fee = parsePesos(draft.perOrderFee);
    if (fee === null || fee < 1 || fee > MAX_PER_ORDER_FEE_COP)
      return { error: FEE_INVALID };
    return {
      billing: {
        model: "PER_ORDER_FEE",
        perOrderFeeCop: fee,
        subscriptionFeeCop: null,
      },
    };
  }
  if (draft.model === "SUBSCRIPTION") {
    if (draft.subscriptionFee.trim() === "")
      return {
        billing: {
          model: "SUBSCRIPTION",
          perOrderFeeCop: null,
          subscriptionFeeCop: null,
        },
      };
    const monthly = parsePesos(draft.subscriptionFee);
    if (monthly === null || monthly < 1 || monthly > MAX_SUBSCRIPTION_FEE_COP)
      return { error: MONTHLY_INVALID };
    return {
      billing: {
        model: "SUBSCRIPTION",
        perOrderFeeCop: null,
        subscriptionFeeCop: monthly,
      },
    };
  }
  return {
    billing: { model: "NONE", perOrderFeeCop: null, subscriptionFeeCop: null },
  };
}

const WHEN = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function auditWho(entry: CafeteriaAuditEntry) {
  if (entry.source === "SQL") return "Cambio manual (SQL)";
  return entry.changedBy?.name ?? "Administrador global";
}

export const auditWhen = (entry: CafeteriaAuditEntry) =>
  WHEN.format(new Date(entry.changedAt));

export function auditChange(entry: CafeteriaAuditEntry) {
  if (entry.setting === "VISIBILITY")
    return `Visibilidad: ${visibilityLabel(entry.oldValue.visible)} → ${visibilityLabel(entry.newValue.visible)}`;
  if (entry.oldValue === null)
    return `Cobro inicial: ${billingLabel(entry.newValue)}`;
  return `Cobro: ${billingLabel(entry.oldValue)} → ${billingLabel(entry.newValue)}`;
}
