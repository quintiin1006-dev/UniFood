"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAdminProfile } from "@/features/admin-profile/context";
import { dashboardCache } from "./cache";
import { AdminDashboardStore } from "./state";

/** The signed-in admin and their cafeteria, as the server reported them; null until known. */
function cacheScope(profile: ReturnType<typeof useAdminProfile>["data"]) {
  if (!profile) return null;
  return JSON.stringify([
    profile.email,
    profile.institution.name,
    profile.site.name,
    profile.cafeteria.name,
  ]);
}

export function useAdminDashboard() {
  const [store] = useState(() => new AdminDashboardStore());
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const scope = cacheScope(useAdminProfile().data);
  // Declared before the loading effect, so it runs first: an entry is only usable for the same
  // admin and cafeteria, and another scope empties the cache.
  useEffect(() => {
    dashboardCache.use(scope);
  }, [scope]);
  useEffect(() => {
    // Loads once when opened; no polling and no reload on focus or visibility.
    void store.load();
    const forget = () => dashboardCache.clear();
    window.addEventListener("unifood:logout", forget);
    return () => {
      window.removeEventListener("unifood:logout", forget);
      store.dispose();
    };
  }, [store]);
  return { ...state, load: store.load, refresh: store.refresh };
}
