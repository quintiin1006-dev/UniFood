"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { adminCatalogApi } from "./api";
import { AdminCatalogStore } from "./state";

export function useAdminCatalog() {
  const [store] = useState(() => new AdminCatalogStore(adminCatalogApi));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.refresh();
    return store.dispose;
  }, [store]);
  return {
    ...state,
    retry: store.refresh,
    applyConfirmed: store.applyConfirmed,
    invalidateReads: store.invalidateReads,
    denyAccess: store.denyAccess,
  };
}
