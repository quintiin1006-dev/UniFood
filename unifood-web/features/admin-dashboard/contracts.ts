import { bogotaDate, dashboardDate, dateOrdinal } from "./filters";
import {
  DASHBOARD_RANGES,
  type AdminDashboardData,
  type DashboardCheck,
  type DashboardCoverage,
  type DashboardFilters,
  type DashboardPeriod,
  type DashboardProduct,
  type DashboardRanking,
  type DashboardSummary,
  type DashboardTrend,
} from "./types";

type RecordValue = Record<string, unknown>;
type Rule = (value: unknown) => boolean;
const record = (v: unknown): v is RecordValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text: Rule = (v) => typeof v === "string";
const boolean: Rule = (v) => typeof v === "boolean";
export const dashboardInteger = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
export const dashboardAmount = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(v);
const nullable =
  (rule: Rule): Rule =>
  (v) =>
    v === null || rule(v);
const oneOf =
  (values: readonly string[]): Rule =>
  (v) =>
    typeof v === "string" && values.includes(v);
const limit: Rule = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 50;
const percent: Rule = (v) =>
  dashboardAmount(v) && BigInt(v.replace(".", "")) <= BigInt(10000);
const uuid: Rule = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
function shape(v: unknown, fields: Record<string, Rule>): v is RecordValue {
  return (
    record(v) &&
    Object.entries(fields).every(
      ([key, rule]) => Object.hasOwn(v, key) && rule(v[key]),
    )
  );
}
/** Used only after validating every listed DTO field. Extra upstream fields never cross the BFF. */
function pick<T>(v: RecordValue, keys: readonly string[]): T {
  return Object.fromEntries(keys.map((key) => [key, v[key]])) as T;
}
export function dashboardInstant(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(v) &&
    dashboardDate(v.slice(0, 10)) &&
    Number(v.slice(11, 13)) < 24 &&
    Number(v.slice(14, 16)) < 60 &&
    Number(v.slice(17, 19)) < 60 &&
    Number.isFinite(Date.parse(v))
  );
}
function nanos(v: string): bigint {
  return (
    BigInt(Date.parse(v.slice(0, 19) + "Z")) * BigInt(1000000) +
    BigInt((v.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(9, "0"))
  );
}
function period(v: unknown): DashboardPeriod | null {
  const fields = {
    range: oneOf(DASHBOARD_RANGES),
    from: dashboardDate,
    to: dashboardDate,
    timezone: oneOf(["America/Bogota"]),
    startInclusive: dashboardInstant,
    calendarEndExclusive: dashboardInstant,
    endExclusive: dashboardInstant,
    asOf: dashboardInstant,
    partial: boolean,
  };
  if (!shape(v, fields)) return null;
  const p = pick<DashboardPeriod>(v, Object.keys(fields));
  const days = dateOrdinal(p.to) - dateOrdinal(p.from) + 1;
  if (days < 1 || days > 366 || p.to > bogotaDate(new Date(p.asOf)))
    return null;
  const start = nanos(p.startInclusive),
    end = nanos(p.endExclusive),
    calendar = nanos(p.calendarEndExclusive),
    asOf = nanos(p.asOf);
  if (
    start > end ||
    calendar <= start ||
    end !== (asOf < calendar ? asOf : calendar) ||
    p.partial !== asOf < calendar
  )
    return null;
  if (
    p.range !== "CUSTOM" &&
    (p.to !== bogotaDate(new Date(p.asOf)) ||
      days !== { TODAY: 1, LAST_7_DAYS: 7, LAST_30_DAYS: 30 }[p.range])
  )
    return null;
  return p;
}
function summary(v: unknown): DashboardSummary | null {
  const fields = {
    receivedOrders: dashboardInteger,
    deliveredOrders: dashboardInteger,
    notCollectedOrders: dashboardInteger,
    notCollectedUnits: nullable(dashboardInteger),
    receivedOrderValue: nullable(dashboardAmount),
    deliveredOrderValue: nullable(dashboardAmount),
    notCollectedOrderValue: nullable(dashboardAmount),
    notCollectedItemValue: nullable(dashboardAmount),
    notCollectedRatePercent: nullable(percent),
    notCollectedRateDenominator: dashboardInteger,
  };
  if (!shape(v, fields)) return null;
  const s = pick<DashboardSummary>(v, Object.keys(fields));
  if (
    (s.notCollectedRateDenominator === "0") !==
    (s.notCollectedRatePercent === null)
  )
    return null;
  return s;
}
function ranking(v: unknown, uncollected: boolean): DashboardRanking | null {
  if (
    !shape(v, {
      availability: oneOf(["AVAILABLE", "UNAVAILABLE_INCOMPLETE_ITEMS"]),
      limit,
      hasMore: boolean,
    }) ||
    !record(v.totals) ||
    !record(v.omitted) ||
    !Array.isArray(v.items)
  )
    return null;
  const unavailable = v.availability === "UNAVAILABLE_INCOMPLETE_ITEMS";
  const integer = unavailable ? (x: unknown) => x === null : dashboardInteger;
  const money = unavailable ? (x: unknown) => x === null : dashboardAmount;
  if (
    !shape(v.totals, {
      products: integer,
      orders: integer,
      units: integer,
      itemValue: money,
    }) ||
    !shape(v.omitted, {
      products: integer,
      units: integer,
      itemValue: money,
    }) ||
    v.items.length > (v.limit as number) ||
    (unavailable && (v.items.length > 0 || v.hasMore !== false))
  )
    return null;
  if (!unavailable) {
    const declaredProducts = BigInt(v.totals.products as string);
    const rowLimit = BigInt(v.limit as number);
    const expectedRows =
      declaredProducts < rowLimit ? declaredProducts : rowLimit;
    // Validate completeness of the published Top, without deriving or replacing its metrics.
    if (
      BigInt(v.items.length) !== expectedRows ||
      v.hasMore !== declaredProducts > rowLimit
    )
      return null;
  }
  const products: DashboardProduct[] = [];
  const ids = new Set<string>();
  const fields = {
    productId: uuid,
    historicalName: nullable(text),
    units: dashboardInteger,
    orders: dashboardInteger,
    itemValue: dashboardAmount,
    unitSharePercent: uncollected ? percent : (x: unknown) => x === null,
  };
  for (const item of v.items) {
    if (!shape(item, fields)) return null;
    const p = pick<DashboardProduct>(item, Object.keys(fields));
    if (
      ids.has(p.productId.toLowerCase()) ||
      p.units === "0" ||
      p.orders === "0" ||
      (p.historicalName !== null && !p.historicalName.trim())
    )
      return null;
    ids.add(p.productId.toLowerCase());
    products.push(p);
  }
  return {
    availability: v.availability as DashboardRanking["availability"],
    limit: v.limit as number,
    hasMore: v.hasMore as boolean,
    totals: pick(v.totals, ["products", "orders", "units", "itemValue"]),
    omitted: pick(v.omitted, ["products", "units", "itemValue"]),
    items: products,
  };
}
const events = ["RECEIVED", "DELIVERED", "NOT_COLLECTED"] as const;
const checkCodes = [
  "TERMINAL_DATE_VALIDITY",
  "HEADER_AMOUNT_VALIDITY",
  "ITEM_INTEGRITY",
  "HEADER_ITEM_RECONCILIATION",
  "HISTORICAL_NAME",
  "UNDATED_TERMINALS",
] as const;
const bases = [
  "CREATED_COHORT",
  "RECORDED_TERMINAL_EVENTS",
  "SELECTED_EVENT_ORDERS",
  "CAFETERIA_ALL_HISTORY",
] as const;
const warningCodes = new Set([
  "UNDATED_TERMINALS_NOT_ASSESSED",
  "UNVERIFIED_ORDER_PROVENANCE",
  "NO_VERIFIABLE_EVENTS",
  "INVALID_TERMINAL_DATES_CREATED_COHORT",
  "INVALID_TERMINAL_DATES_RECORDED_TERMINAL_EVENTS",
  ...events.flatMap((e) =>
    [
      "INVALID_HEADER_AMOUNT_",
      "INCOMPLETE_ITEMS_",
      "HEADER_ITEM_MISMATCH_",
      "MISSING_HISTORICAL_NAME_",
    ].map((prefix) => prefix + e),
  ),
]);
const effects = new Set([
  "ALL_METRICS",
  "TERMINAL_METRICS",
  ...events.flatMap((e) =>
    ["_ORDER_VALUE", "_ITEM_METRICS", "_VALUES", "_PRODUCT_NAMES"].map(
      (suffix) => e + suffix,
    ),
  ),
]);
const stringArray = (v: unknown, rule: Rule): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(rule);
function coverage(v: unknown, p: DashboardPeriod): DashboardCoverage | null {
  if (
    !shape(v, {
      assessment: oneOf(["LIMITED"]),
      assessedAt: dashboardInstant,
    }) ||
    !shape(v.provenance, {
      status: oneOf(["UNKNOWN"]),
      verifiedRealOrders: (x) => x === null,
    }) ||
    !Array.isArray(v.checks) ||
    v.checks.length !== 15 ||
    !Array.isArray(v.warnings) ||
    v.warnings.length > 32 ||
    v.assessedAt !== p.asOf
  )
    return null;
  const checks: DashboardCheck[] = [];
  const keys = new Set<string>();
  for (const c of v.checks) {
    if (
      !shape(c, {
        code: oneOf(checkCodes),
        status: oneOf(["PASS", "WARN", "NOT_CHECKED"]),
        examinedOrders: nullable(dashboardInteger),
        affectedOrders: nullable(dashboardInteger),
        assessedAt: dashboardInstant,
      }) ||
      !shape(c.scope, {
        basis: oneOf(bases),
        startInclusive: nullable(dashboardInstant),
        endExclusive: nullable(dashboardInstant),
      }) ||
      !stringArray(c.scope.eventTypes, oneOf([...events, "CANCELLED"])) ||
      new Set(c.scope.eventTypes).size !== c.scope.eventTypes.length ||
      c.assessedAt !== p.asOf
    )
      return null;
    const scope = c.scope;
    if (!stringArray(scope.eventTypes, oneOf([...events, "CANCELLED"])))
      return null;
    const global = scope.basis === "CAFETERIA_ALL_HISTORY";
    if (global && c.status !== "NOT_CHECKED") return null;
    if (
      global
        ? scope.startInclusive !== null || scope.endExclusive !== null
        : scope.startInclusive !== p.startInclusive ||
          scope.endExclusive !== p.endExclusive
    )
      return null;
    if (c.status === "NOT_CHECKED") {
      if (c.examinedOrders !== null || c.affectedOrders !== null) return null;
    } else {
      if (
        !dashboardInteger(c.examinedOrders) ||
        !dashboardInteger(c.affectedOrders) ||
        BigInt(c.affectedOrders) > BigInt(c.examinedOrders) ||
        (c.status === "PASS") !== (c.affectedOrders === "0")
      )
        return null;
    }
    const key = `${c.code}:${scope.basis}:${scope.eventTypes.join(",")}`;
    if (keys.has(key)) return null;
    keys.add(key);
    checks.push({
      ...pick<DashboardCheck>(c, [
        "code",
        "status",
        "examinedOrders",
        "affectedOrders",
        "assessedAt",
      ]),
      scope: {
        ...pick<DashboardCheck["scope"]>(scope, [
          "basis",
          "startInclusive",
          "endExclusive",
        ]),
        eventTypes: [
          ...scope.eventTypes,
        ] as DashboardCheck["scope"]["eventTypes"],
      },
    });
  }
  const expected = [
    "TERMINAL_DATE_VALIDITY:CREATED_COHORT:RECEIVED",
    "TERMINAL_DATE_VALIDITY:RECORDED_TERMINAL_EVENTS:DELIVERED,NOT_COLLECTED",
    "UNDATED_TERMINALS:CAFETERIA_ALL_HISTORY:DELIVERED,NOT_COLLECTED,CANCELLED",
    ...events.flatMap((e) =>
      [
        "HEADER_AMOUNT_VALIDITY",
        "ITEM_INTEGRITY",
        "HEADER_ITEM_RECONCILIATION",
        "HISTORICAL_NAME",
      ].map((code) => `${code}:SELECTED_EVENT_ORDERS:${e}`),
    ),
  ];
  if (!expected.every((key) => keys.has(key))) return null;
  const warnings: DashboardCoverage["warnings"] = [];
  for (const warning of v.warnings) {
    if (
      !shape(warning, {
        code: (x) => typeof x === "string" && warningCodes.has(x),
      }) ||
      !stringArray(
        warning.affects,
        (x) => typeof x === "string" && effects.has(x),
      )
    )
      return null;
    warnings.push({
      code: warning.code as string,
      affects: [...warning.affects],
    });
  }
  if (
    !["UNVERIFIED_ORDER_PROVENANCE", "UNDATED_TERMINALS_NOT_ASSESSED"].every(
      (code) => warnings.some((w) => w.code === code),
    )
  )
    return null;
  for (const check of checks.filter((c) => c.status === "WARN")) {
    const event = check.scope.eventTypes[0];
    const warning =
      check.code === "TERMINAL_DATE_VALIDITY"
        ? "INVALID_TERMINAL_DATES_" + check.scope.basis
        : (
            {
              HEADER_AMOUNT_VALIDITY: "INVALID_HEADER_AMOUNT_",
              ITEM_INTEGRITY: "INCOMPLETE_ITEMS_",
              HEADER_ITEM_RECONCILIATION: "HEADER_ITEM_MISMATCH_",
              HISTORICAL_NAME: "MISSING_HISTORICAL_NAME_",
            } as Record<string, string>
          )[check.code] + event;
    if (!warnings.some((w) => w.code === warning)) return null;
  }
  return {
    assessment: "LIMITED",
    assessedAt: v.assessedAt as string,
    checks,
    provenance: { status: "UNKNOWN", verifiedRealOrders: null },
    warnings,
  };
}

/** Validate and project the actual P1 DTO. No amounts, ratios or totals are recalculated. */
export function parseAdminDashboard(
  value: unknown,
  requested?: DashboardFilters,
): AdminDashboardData | null {
  if (
    !record(value) ||
    value.basis !== "EVENT_DATE" ||
    value.currency !== "COP"
  )
    return null;
  const p = period(value.period),
    s = summary(value.summary);
  const delivered = ranking(value.topDeliveredProducts, false),
    notCollected = ranking(value.notCollectedProducts, true);
  if (!p || !s || !delivered || !notCollected || !Array.isArray(value.trend))
    return null;
  if (
    requested &&
    (p.range !== requested.range ||
      delivered.limit !== requested.rankingLimit ||
      notCollected.limit !== requested.rankingLimit ||
      (requested.range === "CUSTOM" &&
        (p.from !== requested.from || p.to !== requested.to)))
  )
    return null;
  if (delivered.limit !== notCollected.limit) return null;
  if (
    notCollected.availability === "UNAVAILABLE_INCOMPLETE_ITEMS" &&
    (s.notCollectedUnits !== null || s.notCollectedItemValue !== null)
  )
    return null;
  const trend: DashboardTrend[] = [];
  if (value.trend.length !== dateOrdinal(p.to) - dateOrdinal(p.from) + 1)
    return null;
  for (let i = 0; i < value.trend.length; i++) {
    const day = value.trend[i];
    const fields = {
      date: dashboardDate,
      receivedOrders: dashboardInteger,
      deliveredOrders: dashboardInteger,
      notCollectedOrders: dashboardInteger,
    };
    if (
      !shape(day, fields) ||
      dateOrdinal(day.date as string) !== dateOrdinal(p.from) + i
    )
      return null;
    trend.push(pick<DashboardTrend>(day, Object.keys(fields)));
  }
  const c = coverage(value.coverage, p);
  if (!c) return null;
  return {
    period: p,
    basis: "EVENT_DATE",
    currency: "COP",
    summary: s,
    trend,
    topDeliveredProducts: delivered,
    notCollectedProducts: notCollected,
    coverage: c,
  };
}
