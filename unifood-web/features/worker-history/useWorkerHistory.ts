"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { workerHistoryApi } from "./api";
import { WorkerHistoryStore } from "./state";

export function useWorkerHistory() {
  const [store] = useState(() => new WorkerHistoryStore(workerHistoryApi));
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
  return { ...state, refresh: store.refresh, setQuery: store.setQuery };
}
