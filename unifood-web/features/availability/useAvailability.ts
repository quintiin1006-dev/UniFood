"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWorkerStore } from "@/features/worker-ui/session";
import { availabilityApi } from "./api";
import { AvailabilityStore } from "./state";

/** E1 (jj/cliente-ajustes-2): how often Disponibilidad reads again while the tab is visible. */
export const AVAILABILITY_POLL_MS = 30_000;

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
    const visible = () => document.visibilityState === "visible";
    const onFocus = () => {
      void store.refresh();
    };
    // A hidden tab does not poll; coming back reads at once. The refresh keeps the data on
    // screen (no skeleton) and the page keeps its scroll.
    const onVisibility = () => {
      if (visible()) void store.refresh();
    };
    const timer = window.setInterval(() => {
      if (visible()) void store.refresh();
    }, AVAILABILITY_POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
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
