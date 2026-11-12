"use client";
import { useCallback, useEffect, useState } from "react";
import { toCafeteriaMenu } from "../domain/menu";
import type { CafeteriaMenu } from "../types";

export type CafeteriaMenuState =
  | { status: "idle" | "loading" | "error" | "unavailable" }
  | { status: "ok"; menu: CafeteriaMenu };

/**
 * The cart lives in the browser, so the cart and the test checkout read its cafeteria's menu
 * through the BFF route. Names and prices are for display; the backend recomputes them.
 */
export function useCafeteriaMenu(cafeteriaId: string | null) {
  const [state, setState] = useState<CafeteriaMenuState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!cafeteriaId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => setState({ status: "loading" }), 0);
    fetch(`/api/me/menu?cafeteriaId=${encodeURIComponent(cafeteriaId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404 || response.status === 403)
          return setState({ status: "unavailable" });
        const menu = response.ok
          ? toCafeteriaMenu(await response.json())
          : null;
        setState(
          menu && menu.cafeteria.id === cafeteriaId
            ? { status: "ok", menu }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cafeteriaId, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state: cafeteriaId ? state : { status: "idle" as const }, retry };
}
