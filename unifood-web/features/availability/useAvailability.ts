"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWorkerStore } from "@/features/worker-ui/session";
import { availabilityApi } from "./api";
import { AvailabilityStore } from "./state";

export function useAvailability() {
  const store = useWorkerStore(
    "availability",
    () => new AvailabilityStore(availabilityApi),
  );
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
