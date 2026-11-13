import type { AdminDashboardData, DashboardFilters } from "./types";

/**
 * In-memory cache of closed past periods only. A past Bogotá day cannot change: every event is
 * dated by the server's clock when it happens (created, delivered, not collected) and terminal
 * states are final, so a period that ended before today keeps its numbers. Today, or any range
 * that includes it, is never cached. Entries belong to one scope (the signed-in admin and their
 * cafeteria); a different scope or a logout empties the cache, so nothing is ever mixed.
 */
export class DashboardCache {
  private scope: string | null = null;
  private entries = new Map<string, AdminDashboardData>();

  /** Switches to the scope of the current session; any other scope empties the cache. */
  use(scope: string | null) {
    if (scope !== this.scope) {
      this.entries.clear();
      this.scope = scope;
    }
  }

  clear() {
    this.entries.clear();
    this.scope = null;
  }

  get size() {
    return this.entries.size;
  }

  get(filters: DashboardFilters, today: string): AdminDashboardData | null {
    if (!this.scope || !closedRequest(filters, today)) return null;
    return this.entries.get(key(this.scope, filters)) ?? null;
  }

  set(filters: DashboardFilters, data: AdminDashboardData, today: string) {
    if (!this.scope || !closedRequest(filters, today)) return;
    // The server's own period must be closed too: no partial data and the same past dates.
    if (
      data.period.partial !== false ||
      data.period.range !== "CUSTOM" ||
      data.period.from !== filters.from ||
      data.period.to !== filters.to ||
      !(data.period.to < today)
    )
      return;
    this.entries.set(key(this.scope, filters), data);
  }
}

function closedRequest(filters: DashboardFilters, today: string) {
  return (
    filters.range === "CUSTOM" &&
    typeof filters.from === "string" &&
    typeof filters.to === "string" &&
    filters.to < today
  );
}

function key(scope: string, filters: DashboardFilters) {
  return JSON.stringify([
    scope,
    filters.range,
    filters.from,
    filters.to,
    filters.rankingLimit,
  ]);
}

/** One cache per browser tab, shared by every dashboard mount of the session. */
export const dashboardCache = new DashboardCache();
