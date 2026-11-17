"use client";

import { useCallback, useEffect, useState } from "react";
import { cashApi } from "./api";
import type { CashListing, CashProblem } from "./types";

/** Today in Bogota as yyyy-mm-dd, whatever the browser's zone. */
export function bogotaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A Bogota date moved by whole days (calendar arithmetic in UTC, no DST in Colombia). */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Closures of a date range: the ADMIN's cafeteria, or every one for SUPER_ADMIN (read). */
export function useCashListing({
  superAdmin = false,
  cafeteriaId,
}: { superAdmin?: boolean; cafeteriaId?: string } = {}) {
  const today = bogotaToday();
  const [range, setRange] = useState({ from: shiftDate(today, -6), to: today });
  const [listing, setListing] = useState<CashListing | null>(null);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await cashApi.list(
      range.from,
      range.to,
      superAdmin,
      cafeteriaId,
    );
    setLoading(false);
    if (result.ok) {
      setListing(result.data);
      setProblem(null);
    } else setProblem(result.problem);
  }, [range.from, range.to, superAdmin, cafeteriaId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  return {
    range,
    setRange,
    listing,
    setListing,
    problem,
    loading,
    reload: load,
    exportUrl: cashApi.exportUrl(range.from, range.to, superAdmin, cafeteriaId),
  };
}
