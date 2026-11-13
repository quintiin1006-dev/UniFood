import type {
  BillingCommand,
  BillingModel,
  BillingValue,
  CafeteriaAudit,
  CafeteriaAuditEntry,
  CafeteriaBilling,
  SuperAdminCafeteria,
  SuperAdminCafeterias,
  SuperAdminInstitution,
  SuperAdminSite,
  VisibilityCommand,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTRIES = 500;
const MAX_AUDIT = 50;
export const MAX_PER_ORDER_FEE_COP = 1_000_000;
export const MAX_SUBSCRIPTION_FEE_COP = 100_000_000;
const MAX_VERSION = 2_147_483_647;
const MODELS: readonly BillingModel[] = [
  "NONE",
  "SUBSCRIPTION",
  "PER_ORDER_FEE",
];

type Shape = Record<string, unknown>;
const object = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const flag = (value: unknown): value is boolean => typeof value === "boolean";
const model = (value: unknown): value is BillingModel =>
  typeof value === "string" && (MODELS as readonly string[]).includes(value);
const pesos = (value: unknown, max: number): value is number | null =>
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= max);
const exactKeys = (value: Shape, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export const isCafeteriaId = id;

/** Same rules as migration 022 and Spring: fee only with PER_ORDER_FEE, monthly only with SUBSCRIPTION. */
export function validBillingValue(
  value: unknown,
): value is Shape & BillingValue {
  if (!object(value) || !model(value.model)) return false;
  if (!pesos(value.perOrderFeeCop, MAX_PER_ORDER_FEE_COP)) return false;
  if (!pesos(value.subscriptionFeeCop, MAX_SUBSCRIPTION_FEE_COP)) return false;
  if ((value.model === "PER_ORDER_FEE") !== (value.perOrderFeeCop !== null))
    return false;
  return value.subscriptionFeeCop === null || value.model === "SUBSCRIPTION";
}

/** Picks only the known fields; anything malformed rejects the whole payload. */
function list<T>(
  value: unknown,
  item: (entry: unknown) => T | null,
  max = MAX_ENTRIES,
) {
  if (!Array.isArray(value) || value.length > max) return null;
  const parsed: T[] = [];
  for (const entry of value) {
    const result = item(entry);
    if (!result) return null;
    parsed.push(result);
  }
  return parsed;
}

function billing(value: unknown): CafeteriaBilling | null {
  if (
    !object(value) ||
    !validBillingValue(value) ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 0 ||
    value.version > MAX_VERSION
  )
    return null;
  return {
    model: value.model,
    perOrderFeeCop: value.perOrderFeeCop,
    subscriptionFeeCop: value.subscriptionFeeCop,
    version: value.version,
  };
}

export function parseSuperAdminCafeteria(
  value: unknown,
): SuperAdminCafeteria | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !flag(value.visible) ||
    !flag(value.hasActiveAdmin)
  )
    return null;
  const parsed = billing(value.billing);
  if (!parsed) return null;
  return {
    id: value.id,
    name: value.name,
    visible: value.visible,
    hasActiveAdmin: value.hasActiveAdmin,
    billing: parsed,
  };
}

function site(value: unknown): SuperAdminSite | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !text(value.city) ||
    !flag(value.active)
  )
    return null;
  const cafeterias = list(value.cafeterias, parseSuperAdminCafeteria);
  if (!cafeterias) return null;
  return {
    id: value.id,
    name: value.name,
    city: value.city,
    active: value.active,
    cafeterias,
  };
}

function institution(value: unknown): SuperAdminInstitution | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !flag(value.active)
  )
    return null;
  const sites = list(value.sites, site);
  if (!sites) return null;
  return { id: value.id, name: value.name, active: value.active, sites };
}

export function parseSuperAdminCafeterias(
  value: unknown,
): SuperAdminCafeterias | null {
  if (!object(value)) return null;
  const institutions = list(value.institutions, institution);
  return institutions ? { institutions } : null;
}

function billingValue(value: unknown): BillingValue | null {
  if (!validBillingValue(value)) return null;
  return {
    model: value.model,
    perOrderFeeCop: value.perOrderFeeCop,
    subscriptionFeeCop: value.subscriptionFeeCop,
  };
}

function auditEntry(value: unknown): CafeteriaAuditEntry | null {
  if (
    !object(value) ||
    typeof value.changedAt !== "string" ||
    Number.isNaN(Date.parse(value.changedAt)) ||
    (value.source !== "API" && value.source !== "SQL")
  )
    return null;
  let changedBy: { name: string } | null = null;
  if (value.changedBy !== null) {
    if (!object(value.changedBy) || !text(value.changedBy.name)) return null;
    changedBy = { name: value.changedBy.name };
  }
  const source: "API" | "SQL" = value.source === "API" ? "API" : "SQL";
  const common = { changedAt: value.changedAt, changedBy, source };
  if (value.setting === "VISIBILITY") {
    if (
      !object(value.oldValue) ||
      !object(value.newValue) ||
      !flag(value.oldValue.visible) ||
      !flag(value.newValue.visible)
    )
      return null;
    return {
      setting: "VISIBILITY",
      oldValue: { visible: value.oldValue.visible },
      newValue: { visible: value.newValue.visible },
      ...common,
    };
  }
  if (value.setting === "BILLING") {
    const next = billingValue(value.newValue);
    // Spring sends {} for the row created with the cafeteria; the BFF forwards it as null,
    // and the browser parses that same payload again.
    const empty =
      value.oldValue === null ||
      (object(value.oldValue) && Object.keys(value.oldValue).length === 0);
    const previous = empty ? null : billingValue(value.oldValue);
    if (!next || (!empty && !previous)) return null;
    return {
      setting: "BILLING",
      oldValue: previous,
      newValue: next,
      ...common,
    };
  }
  return null;
}

export function parseCafeteriaAudit(value: unknown): CafeteriaAudit | null {
  if (!object(value)) return null;
  const entries = list(value.entries, auditEntry, MAX_AUDIT);
  return entries ? { entries } : null;
}

// ---------------------------------------------------------------- BFF request bodies

/** Exactly {visible, expectedVisible}, both booleans. */
export function parseVisibilityCommand(
  value: unknown,
): VisibilityCommand | null {
  if (
    !object(value) ||
    !exactKeys(value, ["visible", "expectedVisible"]) ||
    !flag(value.visible) ||
    !flag(value.expectedVisible)
  )
    return null;
  return { visible: value.visible, expectedVisible: value.expectedVisible };
}

/** Exactly the four keys, with the 022 rules. */
export function parseBillingCommand(value: unknown): BillingCommand | null {
  if (
    !object(value) ||
    !exactKeys(value, [
      "model",
      "perOrderFeeCop",
      "subscriptionFeeCop",
      "expectedVersion",
    ]) ||
    !validBillingValue(value) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isInteger(value.expectedVersion) ||
    value.expectedVersion < 0 ||
    value.expectedVersion > MAX_VERSION
  )
    return null;
  return {
    model: value.model,
    perOrderFeeCop: value.perOrderFeeCop,
    subscriptionFeeCop: value.subscriptionFeeCop,
    expectedVersion: value.expectedVersion,
  };
}
