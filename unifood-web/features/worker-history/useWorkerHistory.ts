"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWorkerStore } from "@/features/worker-ui/session";
import { workerHistoryApi } from "./api";
import { WorkerHistoryStore } from "./state";

export function useWorkerHistory() {
  // Kept per account: back in Historial its rows, filters and pages are there at once (A).
  const store = useWorkerStore(
    "history",
    () => new WorkerHistoryStore(workerHistoryApi),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.start({
      now: () => Date.now(),
      visible: () => document.visibilityState === "visible",
      later: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
      onFocus(callback) {
        window.addEventListener("focus", callback);
        return () => window.removeEventListener("focus", callback);
      },
      onVisibility(callback) {
        document.addEventListener("visibilitychange", callback);
        return () => document.removeEventListener("visibilitychange", callback);
      },
    });
    return store.dispose;
  }, [store]);
  return {
    ...state,
    refresh: store.refresh,
    loadMore: store.loadMore,
    setQuery: store.setQuery,
    setRange: store.setRange,
    setStatus: store.setStatus,
    clearFilters: store.clearFilters,
  };
}
