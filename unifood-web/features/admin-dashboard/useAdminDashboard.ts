"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AdminDashboardStore } from "./state";

export function useAdminDashboard() {
  const [store] = useState(() => new AdminDashboardStore());
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.load();
    const refresh = () => {
      if (document.visibilityState === "visible") void store.load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      store.dispose();
    };
  }, [store]);
  return { ...state, load: store.load };
}
