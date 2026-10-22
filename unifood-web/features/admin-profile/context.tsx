"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { adminProfileApi } from "./api";
import { AdminProfileStore } from "./state";

function useProfileState() {
  const [store] = useState(() => new AdminProfileStore(adminProfileApi));
  const pathname = usePathname();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.refresh();
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      store.dispose();
    };
  }, [store, pathname]);
  return { ...state, retry: store.refresh };
}
const Context = createContext<ReturnType<typeof useProfileState> | null>(null);
export function AdminProfileProvider({ children }: { children: ReactNode }) {
  const profile = useProfileState();
  return <Context.Provider value={profile}>{children}</Context.Provider>;
}
export function useAdminProfile() {
  const profile = useContext(Context);
  if (!profile) throw new Error("AdminProfileProvider is required");
  return profile;
}
