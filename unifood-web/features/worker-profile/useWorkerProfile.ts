"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { workerProfileApi } from "./api";
import { WorkerProfileStore } from "./state";

export function useWorkerProfile() {
  const [store] = useState(() => new WorkerProfileStore(workerProfileApi));
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
