"use client";
import { useCallback, useEffect, useState } from "react";
import { toCafeteriaMenu } from "../domain/menu";
import { createMenuRefresher, sameMenu, type MenuRead } from "../menuRefresh";
import type { CafeteriaMenu } from "../types";

export type CafeteriaMenuState =
  | { status: "idle" | "loading" | "error" | "unavailable" }
  | { status: "ok"; menu: CafeteriaMenu };

type Entry =
  | { cafeteriaId: string; status: "ok"; menu: CafeteriaMenu; stale: boolean }
  | { cafeteriaId: string; status: "error" | "unavailable" };

const READ_TIMEOUT_MS = 15_000;

/** One read of the menu through the BFF; names and prices are for display only. */
async function readMenu(cafeteriaId: string): Promise<MenuRead> {
  try {
    const response = await fetch(
      `/api/me/menu?cafeteriaId=${encodeURIComponent(cafeteriaId)}`,
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      },
    );
    if (response.status === 404 || response.status === 403)
      return { kind: "unavailable" };
    if (!response.ok) return { kind: "error" };
    const menu = toCafeteriaMenu(await response.json());
    return menu && menu.cafeteria.id === cafeteriaId
      ? { kind: "ok", menu }
      : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/**
 * The cafeteria's menu, kept fresh: read again every 30 s while the tab is visible, at once when
 * it comes back or the window gets focus, with a longer wait after failures. Once a menu is on
 * screen, refreshes never show a loading state; a failed refresh keeps it and sets `stale`.
 * `initial` is the menu the server already rendered, so the first screen needs no request.
 */
export function useCafeteriaMenu(
  cafeteriaId: string | null,
  initial?: CafeteriaMenu,
) {
  // The server's menu seeds the state once; later refreshes replace it.
  const [seed] = useState(initial);
  const [entry, setEntry] = useState<Entry | null>(() =>
    seed
      ? {
          cafeteriaId: seed.cafeteria.id,
          status: "ok",
          menu: seed,
          stale: false,
        }
      : null,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!cafeteriaId) return;
    const id = cafeteriaId;
    let alive = true;
    const refresher = createMenuRefresher({
      load: () => readMenu(id),
      isVisible: () => document.visibilityState !== "hidden",
      onResult: (read) => {
        if (!alive) return;
        if (read.kind === "ok") {
          setEntry((previous) =>
            previous &&
            previous.cafeteriaId === id &&
            previous.status === "ok" &&
            !previous.stale &&
            sameMenu(previous.menu, read.menu)
              ? previous
              : {
                  cafeteriaId: id,
                  status: "ok",
                  menu: read.menu,
                  stale: false,
                },
          );
          return;
        }
        setEntry((previous) => {
          // A menu already on screen stays; the page says it may be out of date.
          if (
            previous &&
            previous.cafeteriaId === id &&
            previous.status === "ok"
          )
            return previous.stale ? previous : { ...previous, stale: true };
          return {
            cafeteriaId: id,
            status: read.kind === "unavailable" ? "unavailable" : "error",
          };
        });
      },
    });
    const onVisibility = () => refresher.visibilityChanged();
    const onFocus = () => refresher.refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    refresher.start(!(seed && seed.cafeteria.id === id));
    return () => {
      alive = false;
      refresher.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
    // The seed is read once; only the cafeteria and an explicit retry start a new loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafeteriaId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // An entry for another cafeteria is never shown: the page is waiting for its own menu.
  const current =
    entry && cafeteriaId && entry.cafeteriaId === cafeteriaId ? entry : null;
  const state: CafeteriaMenuState = !cafeteriaId
    ? { status: "idle" }
    : !current
      ? { status: "loading" }
      : current.status === "ok"
        ? { status: "ok", menu: current.menu }
        : { status: current.status };
  const stale = current?.status === "ok" && current.stale;
  return { state, retry, stale };
}
