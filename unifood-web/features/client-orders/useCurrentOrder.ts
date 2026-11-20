"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrder, pollCurrentOrder } from "./api";
import { connectionFailure, orderFailure, type OrderFailure } from "./errors";
import { alertFor, createPoller, type OrderAlert } from "./polling";
import type { ClientOrder } from "./types";
import { sessionStore } from "@/features/shared/sessionStore";

/** The last answer of this session: back in Mi pedido it shows at once, then refreshes (A). */
const lastState = () =>
  sessionStore("client:current-order", () => ({
    value: null as CurrentOrderState | null,
  }));

export type CurrentOrderState = {
  /** The first answer arrived (an order, or none). */
  loaded: boolean;
  order: ClientOrder | null;
  /** The last state of the order that just ended (delivered, rejected, cancelled…). */
  finished: ClientOrder | null;
  /** Nothing to show yet and the read failed: a full-page error with «Reintentar». */
  failure: OrderFailure | null;
  /** A later read failed: the last known order stays on screen with a banner. */
  offline: boolean;
};

const INITIAL: CurrentOrderState = {
  loaded: false,
  order: null,
  finished: null,
  failure: null,
  offline: false,
};

/**
 * «Mi pedido»: polls GET /api/me/orders/current (ETag, pause while hidden, backoff) and reports
 * each move that deserves a notice through `onAlert`. When the active order disappears, its
 * last state is fetched once so the client can read how it ended.
 */
export function useCurrentOrder(onAlert: (alert: OrderAlert) => void) {
  const [state, setState] = useState<CurrentOrderState>(
    () => lastState().value ?? INITIAL,
  );
  const alertRef = useRef(onAlert);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    alertRef.current = onAlert;
  });

  // Only a real answer is kept; a failure never outlives the screen that saw it.
  useEffect(() => {
    lastState().value =
      state.loaded && !state.failure ? { ...state, offline: false } : null;
  }, [state]);

  useEffect(() => {
    let alive = true;
    const cached = lastState().value;
    let current: ClientOrder | null = cached?.order ?? null;
    let loaded = cached?.loaded ?? false;

    const poller = createPoller({
      load: pollCurrentOrder,
      isVisible: () => document.visibilityState !== "hidden",
      onResult: (result) => {
        if (!alive) return;
        if (result.kind === "error") {
          if (result.fatal) {
            // The session is over: nothing of the old order may stay on screen.
            current = null;
            setState({
              loaded: true,
              order: null,
              finished: null,
              failure: result.failure ?? orderFailure(401),
              offline: false,
            });
            return;
          }
          if (!loaded)
            setState((s) => ({ ...s, failure: connectionFailure() }));
          else setState((s) => ({ ...s, offline: true }));
          return;
        }
        if (result.kind === "unchanged") {
          setState((s) => (s.offline ? { ...s, offline: false } : s));
          return;
        }
        loaded = true;
        if (result.kind === "order") {
          const alert = alertFor(current, result.order);
          current = result.order;
          setState({
            loaded: true,
            order: result.order,
            finished: null,
            failure: null,
            offline: false,
          });
          if (alert) alertRef.current(alert);
          return;
        }
        const ended = current;
        current = null;
        setState({
          loaded: true,
          order: null,
          finished: null,
          failure: null,
          offline: false,
        });
        if (ended)
          void fetchOrder(ended.id).then((outcome) => {
            if (alive && outcome.ok && !current)
              setState((s) => ({ ...s, finished: outcome.value }));
          });
      },
    });

    const onVisibility = () => poller.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    refreshRef.current = () => poller.refresh();
    poller.start();
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
    };
  }, []);

  /** Reads now: «Reintentar» and right after cancelling. */
  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...state, refresh };
}
