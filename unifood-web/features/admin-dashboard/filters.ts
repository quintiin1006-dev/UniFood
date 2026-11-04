import { DASHBOARD_RANGES, type DashboardFilters } from "./types";

export function dashboardDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function bogotaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}
export const dateOrdinal = (date: string) =>
  Date.parse(date + "T00:00:00Z") / 86400000;

/** Unknown parameters are rejected. A null clock leaves future-date checks to the server. */
export function parseDashboardFilters(
  parameters: URLSearchParams,
  now: Date | null = new Date(),
): DashboardFilters | null {
  const allowed = new Set(["range", "from", "to", "rankingLimit"]);
  for (const [key, value] of parameters) {
    if (
      !allowed.has(key) ||
      parameters.getAll(key).length !== 1 ||
      !value.trim()
    )
      return null;
  }
  const range = parameters.get("range");
  if (!DASHBOARD_RANGES.some((r) => r === range)) return null;
  const limit = parameters.get("rankingLimit");
  if (limit !== null && (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > 50))
    return null;
  const rankingLimit = limit === null ? 10 : Number(limit);
  const from = parameters.get("from"),
    to = parameters.get("to");
  if (range === "CUSTOM") {
    if (
      !dashboardDate(from) ||
      !dashboardDate(to) ||
      from > to ||
      (now !== null && to > bogotaDate(now)) ||
      dateOrdinal(to) - dateOrdinal(from) >= 366
    )
      return null;
    return { range, from, to, rankingLimit };
  }
  if (from !== null || to !== null) return null;
  return { range: range as DashboardFilters["range"], rankingLimit };
}
export function dashboardSearch(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams({
    range: filters.range,
    rankingLimit: String(filters.rankingLimit),
  });
  if (filters.from !== undefined) params.set("from", filters.from);
  if (filters.to !== undefined) params.set("to", filters.to);
  return params;
}
