import "server-only";
import { cache } from "react";
import { toClientContext } from "../domain/context";
import type { ClientContext } from "../types";
import { forwardClientContext } from "./catalogForward";

export type ContextResult =
  { status: "ok"; context: ClientContext } | { status: "error" };

/**
 * Sites, subscribed cafeterias and today's open state, from GET /api/me/context through the
 * BFF forward. Cached per request so the layout of a page and the page share one call.
 */
export const loadClientContext = cache(async (): Promise<ContextResult> => {
  try {
    const response = await forwardClientContext();
    if (response.status !== 200) return { status: "error" };
    const context = toClientContext(await response.json());
    return context ? { status: "ok", context } : { status: "error" };
  } catch {
    return { status: "error" };
  }
});
