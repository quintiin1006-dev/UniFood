"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWorkerStore } from "@/features/worker-ui/session";
import { AVAILABILITY_POLL_MS } from "@/features/availability/useAvailability";
import { workerDailyMenuApi } from "./api";
import { DailyMenuEditorStore } from "./editor";

/**
 * The worker's daily menu of today, read and written through a queue (editor.ts). It reads
 * again with Disponibilidad's rhythm (poll, focus, visibility), but never while a write is
 * pending; what the worker is typing lives in the editor, so a read never touches it.
 */
export function useDailyMenu() {
  const store = useWorkerStore(
    "daily-menu",
    () => new DailyMenuEditorStore(workerDailyMenuApi),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.refresh();
    const visible = () => document.visibilityState === "visible";
    const onFocus = () => void store.refresh();
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
    };
  }, [store]);
  return {
    ...state,
    refresh: store.refresh,
    setOptions: store.setOptions,
    setAddition: store.setAddition,
    runAction: store.runAction,
  };
}
