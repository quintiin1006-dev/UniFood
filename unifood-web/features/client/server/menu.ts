import "server-only";
import { cache } from "react";
import { serverApiUrl } from "@/config/server";
import { getAuth } from "@/features/auth/server/session";
import { toClientMenu, unavailableMenu } from "../domain/menu";
import type { ClientMenu } from "../types";

/**
 * Reads the menu for the verified session's institution. Cached per request, so the layout and
 * the pages share one backend call. The browser never calls the backend for the menu directly.
 */
export const loadClientMenu = cache(async (): Promise<ClientMenu> => {
  const auth = await getAuth();
  if (!auth) return unavailableMenu;
  try {
    const response = await fetch(`${serverApiUrl()}/api/me/menu`, {
      method: "GET",
      headers: { authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) return unavailableMenu;
    return toClientMenu(await response.json());
  } catch {
    return unavailableMenu;
  }
});
