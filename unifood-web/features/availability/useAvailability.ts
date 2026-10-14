"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { availabilityApi } from "./api";
import { AvailabilityStore } from "./state";

export function useAvailability() {
  const [store] = useState(() => new AvailabilityStore(availabilityApi));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.start();
    const onFocus = () => {
      void store.refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      store.dispose();
    };
  }, [store]);
  return {
    ...state,
    refresh: store.refresh,
    setItem: store.setItem,
    setCafeteria: store.setCafeteria,
  };
}
