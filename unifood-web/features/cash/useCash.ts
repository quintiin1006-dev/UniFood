"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cashApi, type CashApi } from "./api";
import type { CashCurrent, CashProblem } from "./types";

const REFRESH_MS = 20_000;

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Browser connectivity; on the server it is assumed online. */
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * The drawer of the worker's cafeteria. Live figures refresh every 20 s while the tab is
 * visible (they come from the server, never computed here) and right after every action.
 */
export function useCash(api: CashApi = cashApi) {
  const [current, setCurrent] = useState<CashCurrent | null>(null);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const online = useOnline();
  const inFlight = useRef(false);

  const load = useCallback(
    async (quiet = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (quiet) setRefreshing(true);
      const result = await api.current();
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
      if (result.ok) {
        setCurrent(result.data);
        setProblem(null);
      } else if (
        !quiet ||
        result.problem.status === 401 ||
        result.problem.status === 403
      ) {
        // A quiet refresh keeps the last figures on a transient failure.
        setProblem(result.problem);
        if (result.problem.status === 401 || result.problem.status === 403)
          setCurrent(null);
      }
    },
    [api],
  );

  useEffect(() => {
    // Initial load; setState happens after the await, never synchronously here.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, REFRESH_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  return {
    current,
    setCurrent,
    problem,
    loading,
    refreshing,
    online,
    refresh: () => load(true),
    retry: () => {
      setLoading(true);
      return load();
    },
  };
}
