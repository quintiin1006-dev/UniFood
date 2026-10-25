import { parseAdminDashboard } from "./contracts";
import { dashboardSearch, parseDashboardFilters } from "./filters";
import { AdminDashboardError, dashboardErrorCode } from "./errors";
import type { AdminDashboardData, DashboardFilterInput } from "./types";

export const adminDashboardApi = {
  async get(
    filters: DashboardFilterInput,
    signal?: AbortSignal,
  ): Promise<AdminDashboardData> {
    if (
      Object.keys(filters).some(
        (key) => !["range", "from", "to", "rankingLimit"].includes(key),
      )
    )
      throw new AdminDashboardError(400);
    const parameters = new URLSearchParams({ range: filters.range });
    if (filters.from !== undefined) parameters.set("from", filters.from);
    if (filters.to !== undefined) parameters.set("to", filters.to);
    if (filters.rankingLimit !== undefined) {
      if (!Number.isInteger(filters.rankingLimit))
        throw new AdminDashboardError(400);
      parameters.set("rankingLimit", String(filters.rankingLimit));
    }
    const validated = parseDashboardFilters(parameters, null);
    if (!validated) throw new AdminDashboardError(400);
    const search = dashboardSearch(validated);
    let response: Response;
    try {
      response = await fetch("/api/admin/dashboard?" + search.toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch (cause) {
      throw new AdminDashboardError(
        cause instanceof Error &&
          ["AbortError", "TimeoutError"].includes(cause.name)
          ? 503
          : 502,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      if (response.status !== 200)
        throw new AdminDashboardError(response.status);
      throw new AdminDashboardError(
        cause instanceof Error &&
          ["AbortError", "TimeoutError"].includes(cause.name)
          ? 503
          : 502,
      );
    }
    if (response.status !== 200) {
      const code =
        body && typeof body === "object" && "code" in body
          ? body.code
          : undefined;
      throw new AdminDashboardError(
        response.status,
        dashboardErrorCode(response.status, code),
      );
    }
    const data = parseAdminDashboard(body, validated);
    if (!data) throw new AdminDashboardError(502);
    return data;
  },
};
