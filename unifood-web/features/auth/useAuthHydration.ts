"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** SSR and the hydration render agree; credentials enable only after hydration. */
export function useAuthHydration() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
