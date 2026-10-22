"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryConfig } from "./config";

export const recoveryStorageKey = "unifood-panel-recovery";

/** PKCE verifier survives opening the email in a new tab; bearer/session never enters login cookies. */
export function createRecoveryClient(config: RecoveryConfig): SupabaseClient {
  const session = new Map<string, string>();
  return createClient(config.url, config.key, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      autoRefreshToken: false,
      persistSession: true,
      storageKey: recoveryStorageKey,
      storage: {
        getItem: (key) =>
          key.startsWith(`${recoveryStorageKey}-code-verifier`)
            ? window.localStorage.getItem(key)
            : (session.get(key) ?? null),
        setItem: (key, value) => {
          if (key.startsWith(`${recoveryStorageKey}-code-verifier`))
            window.localStorage.setItem(key, value);
          else session.set(key, value);
        },
        removeItem: (key) => {
          if (key.startsWith(`${recoveryStorageKey}-code-verifier`))
            window.localStorage.removeItem(key);
          else session.delete(key);
        },
      },
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        }),
    },
  });
}
