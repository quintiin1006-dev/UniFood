"use client";
import { useEffect, useState } from "react";
import { readClientDailyMenu } from "./api";
import type { ClientDailyMenu } from "./types";

export type ClientDailyMenuState =
  | { status: "loading" }
  | { status: "ok"; menu: ClientDailyMenu }
  | { status: "hidden" };

type Entry = {
  cafeteriaId: string;
  reload: number;
  state: ClientDailyMenuState;
};

/**
 * Today's menu for the card, read only while `enabled` (dailyMenu.available in the live menu).
 * A new cafeteria reads again (and shows loading); a pending read
 * for the previous one is aborted and ignored. A new `reload` value reads again (the cart does
 * it when the order says the plate no longer matches).
 */
export function useClientDailyMenu(
  cafeteriaId: string,
  enabled: boolean,
  reload = 0,
): ClientDailyMenuState {
  const [entry, setEntry] = useState<Entry | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    readClientDailyMenu(cafeteriaId, controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      setEntry({
        cafeteriaId,
        reload,
        state:
          read.kind === "ok"
            ? { status: "ok", menu: read.menu }
            : { status: "hidden" },
      });
    });
    return () => controller.abort();
  }, [cafeteriaId, enabled, reload]);
  if (!enabled) return { status: "hidden" };
  return entry?.cafeteriaId === cafeteriaId && entry.reload === reload
    ? entry.state
    : { status: "loading" };
}
