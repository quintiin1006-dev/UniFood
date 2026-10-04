import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfig, rememberCookie, sessionCookieOptions } from "./config";

export async function authClient(remember?: boolean) {
  const config = authConfig();
  if (!config) throw new Error("AUTH_NOT_CONFIGURED");
  const jar = await cookies();
  const persistent = remember ?? jar.get(rememberCookie)?.value === "1";
  return createServerClient(config.url, config.key, {
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000), cache: "no-store" }) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) {
            jar.set(name, value, sessionCookieOptions(persistent, options.maxAge === 0));
          }
        } catch {
          // Server Components are read-only; proxy.ts already refreshed the session.
        }
      },
    },
  });
}
