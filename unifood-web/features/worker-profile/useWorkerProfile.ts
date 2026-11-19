"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWorkerStore } from "@/features/worker-ui/session";
import { workerProfileApi } from "./api";
import { WorkerProfileStore } from "./state";

export function useWorkerProfile() {
  const store = useWorkerStore(
    "profile",
    () => new WorkerProfileStore(workerProfileApi),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.start();
    return store.dispose;
  }, [store]);
  return { ...state, retry: store.refresh };
}
