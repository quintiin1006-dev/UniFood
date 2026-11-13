"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { superAdminApi } from "./api";
import { SuperAdminStore } from "./state";

export function useSuperAdmin() {
  const [store] = useState(() => new SuperAdminStore(superAdminApi));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  return {
    ...state,
    retry: store.load,
    select: store.select,
    setVisibility: store.setVisibility,
    setBilling: store.setBilling,
    refuse: store.refuse,
    reloadAudit: store.loadAudit,
  };
}
