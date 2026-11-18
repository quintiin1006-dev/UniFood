"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHistory } from "./api";
import type { OrderFailure } from "./errors";
import type { OrderHistoryItem } from "./types";

type Phase = "loading" | "ready" | "error";

/** GET /api/me/orders by cursor: the first page, then «Cargar más» appends the next one. */
export function useOrderHistory() {
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const requestId = useRef(0);

  const run = useCallback(async (after: string | null) => {
    const id = ++requestId.current;
    const outcome = await fetchHistory(after);
    if (id !== requestId.current) return;
    if (!outcome.ok) {
      setFailure(outcome.failure);
      setLoadingMore(false);
      if (after === null) setPhase("error");
      return;
    }
    const { orders: page, nextCursor } = outcome.value;
    setFailure(null);
    // A repeated id (a page read twice) is kept once.
    setOrders((current) =>
      after === null
        ? page
        : [
            ...current,
            ...page.filter((o) => !current.some((seen) => seen.id === o.id)),
          ],
    );
    setCursor(nextCursor);
    setPhase("ready");
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    // The first page is read once when the screen opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(null);
  }, [run]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setFailure(null);
    void run(cursor);
  }, [cursor, loadingMore, run]);

  const retry = useCallback(() => {
    setFailure(null);
    if (orders.length === 0) {
      setPhase("loading");
      void run(null);
    } else loadMore();
  }, [orders.length, loadMore, run]);

  /** Reads the first page again without the loading state: a finished order shows up in place. */
  const reload = useCallback(() => {
    setFailure(null);
    void run(null);
  }, [run]);

  return {
    orders,
    phase,
    hasMore: cursor !== null,
    loadingMore,
    failure,
    loadMore,
    retry,
    reload,
  };
}
