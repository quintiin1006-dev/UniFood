export const DASHBOARD_RANGES = [
  "TODAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "CUSTOM",
] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type DashboardFilters = {
  range: DashboardRange;
  from?: string;
  to?: string;
  rankingLimit: number;
};
export type DashboardFilterInput = Omit<DashboardFilters, "rankingLimit"> & {
  rankingLimit?: number;
};
export type DashboardPeriod = {
  range: DashboardRange;
  from: string;
  to: string;
  timezone: "America/Bogota";
  startInclusive: string;
  calendarEndExclusive: string;
  endExclusive: string;
  asOf: string;
  partial: boolean;
};
export type DashboardSummary = {
  receivedOrders: string;
  deliveredOrders: string;
  notCollectedOrders: string;
  notCollectedUnits: string | null;
  receivedOrderValue: string | null;
  deliveredOrderValue: string | null;
  notCollectedOrderValue: string | null;
  notCollectedItemValue: string | null;
  notCollectedRatePercent: string | null;
  notCollectedRateDenominator: string;
};
export type DashboardTrend = {
  date: string;
  receivedOrders: string;
  deliveredOrders: string;
  notCollectedOrders: string;
};
export type DashboardProduct = {
  productId: string;
  historicalName: string | null;
  units: string;
  orders: string;
  itemValue: string;
  unitSharePercent: string | null;
};
export type DashboardRanking = {
  availability: "AVAILABLE" | "UNAVAILABLE_INCOMPLETE_ITEMS";
  limit: number;
  hasMore: boolean;
  totals: {
    products: string | null;
    orders: string | null;
    units: string | null;
    itemValue: string | null;
  };
  omitted: {
    products: string | null;
    units: string | null;
    itemValue: string | null;
  };
  items: DashboardProduct[];
};
export type DashboardEvent =
  "RECEIVED" | "DELIVERED" | "NOT_COLLECTED" | "CANCELLED";
export type DashboardCheckCode =
  | "TERMINAL_DATE_VALIDITY"
  | "HEADER_AMOUNT_VALIDITY"
  | "ITEM_INTEGRITY"
  | "HEADER_ITEM_RECONCILIATION"
  | "HISTORICAL_NAME"
  | "UNDATED_TERMINALS";
export type DashboardScope = {
  basis:
    | "CREATED_COHORT"
    | "RECORDED_TERMINAL_EVENTS"
    | "SELECTED_EVENT_ORDERS"
    | "CAFETERIA_ALL_HISTORY";
  eventTypes: DashboardEvent[];
  startInclusive: string | null;
  endExclusive: string | null;
};
export type DashboardCheck = {
  code: DashboardCheckCode;
  status: "PASS" | "WARN" | "NOT_CHECKED";
  scope: DashboardScope;
  examinedOrders: string | null;
  affectedOrders: string | null;
  assessedAt: string;
};
export type DashboardCoverage = {
  assessment: "LIMITED";
  assessedAt: string;
  checks: DashboardCheck[];
  provenance: { status: "UNKNOWN"; verifiedRealOrders: null };
  warnings: { code: string; affects: string[] }[];
};
export type AdminDashboardData = {
  period: DashboardPeriod;
  basis: "EVENT_DATE";
  currency: "COP";
  summary: DashboardSummary;
  trend: DashboardTrend[];
  topDeliveredProducts: DashboardRanking;
  notCollectedProducts: DashboardRanking;
  coverage: DashboardCoverage;
};
