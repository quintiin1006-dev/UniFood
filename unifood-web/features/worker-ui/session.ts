"use client";
import { createContext, useContext } from "react";
import { sessionStore } from "@/features/shared/sessionStore";

/** The signed-in worker; the panel's data stores are kept per account (A). */
export const WorkerSessionContext = createContext<string>("anonymous");

/**
 * The store of a worker module for this account, kept while the session lasts: going back to the
 * module shows its last data (filters and pages included) instead of the skeleton. Its timers
 * still stop when the module unmounts; the hooks start and dispose it.
 */
export function useWorkerStore<T>(module: string, create: () => T): T {
  const account = useContext(WorkerSessionContext);
  return sessionStore(`worker:${account}:${module}`, create);
}
