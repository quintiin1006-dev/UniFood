import "server-only";
import { cache } from "react";
import { toCafeteriaMenu } from "../domain/menu";
import type { CafeteriaMenu } from "../types";
import { forwardClientMenuFor } from "./catalogForward";

export type MenuResult =
  | { status: "ok"; menu: CafeteriaMenu }
  /** 404 CAFETERIA_NOT_FOUND or 403 CAFETERIA_NOT_SUBSCRIBED: choose another cafeteria. */
  | { status: "unavailable" }
  /** Anything else, including a malformed body: the screen offers a retry. */
  | { status: "error" };

/**
 * Reads one cafeteria's menu through the BFF forward, so the session, role, timeout and
 * error rules are the same as in the browser route. Cached per request: the page and its
 * metadata share one backend call. Spring messages never reach the screen.
 */
export const loadCafeteriaMenu = cache(
  async (cafeteriaId: string): Promise<MenuResult> => {
    try {
      const response = await forwardClientMenuFor(cafeteriaId);
      if (response.status === 404 || response.status === 403)
        return { status: "unavailable" };
      if (response.status !== 200) return { status: "error" };
      const menu = toCafeteriaMenu(await response.json());
      // A menu for another cafeteria than the one asked for is never shown.
      return menu && menu.cafeteria.id === cafeteriaId
        ? { status: "ok", menu }
        : { status: "error" };
    } catch {
      return { status: "error" };
    }
  },
);
