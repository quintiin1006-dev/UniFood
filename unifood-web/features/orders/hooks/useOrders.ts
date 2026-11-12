"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceOrder,
  getOperationalOrders,
  rejectOrder,
  runCalledOrderAction,
} from "@/features/orders/api/orderApi";
import type { CalledOrderAction } from "@/features/orders/calledOrderActions";
import type { Order } from "@/types/order";

export function useOrders(enabled = true) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPriorityError, setIsPriorityError] = useState(false);
  const [busyOrderIds, setBusyOrderIds] = useState<string[]>([]);
  // Which button of an order is in flight, so only that one says it is working.
  const [busyActions, setBusyActions] = useState<
    Record<string, CalledOrderAction>
  >({});
  const pending = useRef(new Set<string>());
  const revision = useRef(0);
  const activeRefresh = useRef<number | null>(null);
  const latestOrders = useRef<Order[]>([]);
  const subscribed = useRef(false);
  const businessDeadline = useRef<string | null>(null);
  const rolloverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const replaceOrders = useCallback((next: Order[]) => {
    latestOrders.current = next;
    setOrders(next);
  }, []);

  const refresh = useCallback(
    async function refreshOrders(): Promise<void> {
      if (
        businessDeadline.current &&
        Date.parse(businessDeadline.current) <= Date.now()
      ) {
        replaceOrders(
          latestOrders.current.filter((order) => order.status !== "delivered"),
        );
      }
      // A slow response must not be invalidated by every polling tick or focus.
      if (
        !subscribed.current ||
        pending.current.size ||
        activeRefresh.current === revision.current
      )
        return;
      const version = ++revision.current;
      activeRefresh.current = version;
      try {
        const listing = await getOperationalOrders();
        if (version !== revision.current || pending.current.size) return;
        businessDeadline.current = listing.nextBusinessDateAt;
        const expired =
          listing.nextBusinessDateAt &&
          Date.parse(listing.nextBusinessDateAt) <= Date.now();
        replaceOrders(
          expired
            ? listing.orders.filter((order) => order.status !== "delivered")
            : listing.orders,
        );
        if (rolloverTimer.current !== undefined)
          clearTimeout(rolloverTimer.current);
        if (listing.nextBusinessDateAt) {
          const delay = Date.parse(listing.nextBusinessDateAt) - Date.now();
          rolloverTimer.current = setTimeout(
            () => {
              replaceOrders(
                latestOrders.current.filter(
                  (order) => order.status !== "delivered",
                ),
              );
              void refreshOrders();
            },
            delay > 0 ? Math.min(delay, 2_147_483_647) : 30000,
          );
        }
        setError(null);
      } catch (cause) {
        if (version === revision.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "No se pudieron cargar los pedidos.",
          );
        }
      } finally {
        if (activeRefresh.current === version) activeRefresh.current = null;
        if (version === revision.current) setLoading(false);
      }
    },
    [replaceOrders],
  );

  const invalidate = useCallback(() => {
    ++revision.current;
  }, []);

  useEffect(() => {
    subscribed.current = enabled;
    if (!enabled) return;
    const initial = setTimeout(() => {
      void refresh();
    }, 0);
    const interval = setInterval(() => {
      void refresh();
    }, 10000);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      subscribed.current = false;
      invalidate();
      clearTimeout(initial);
      clearInterval(interval);
      if (rolloverTimer.current !== undefined)
        clearTimeout(rolloverTimer.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, invalidate, enabled]);

  const clearActionError = useCallback(() => {
    setActionError(null);
    setIsPriorityError(false);
  }, []);

  const mutate = useCallback(
    async (order: Order): Promise<Order | null> => {
      if (pending.current.has(order.id)) return null;
      clearActionError();
      const current = latestOrders.current.find((item) => item.id === order.id);
      if (!current || current.status !== order.status) {
        setActionError(
          "El pedido cambió de estado. Revisa el estado actualizado antes de continuar.",
        );
        return null;
      }
      if (
        current.status === "delivered" ||
        current.status === "cancelled" ||
        current.status === "not_collected"
      )
        return null;
      pending.current.add(order.id);
      ++revision.current;
      setBusyOrderIds([...pending.current]);
      try {
        const updated = await advanceOrder(current);
        replaceOrders(
          latestOrders.current.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        );
        return updated;
      } catch (cause) {
        const apiError = cause as Error & { status?: number };
        const message =
          cause instanceof Error
            ? cause.message
            : "No se pudo actualizar el pedido.";
        setIsPriorityError(
          current.status === "pending" &&
            apiError.status === 409 &&
            /pedido anterior/i.test(message),
        );
        setActionError(message);
        return null;
      } finally {
        pending.current.delete(order.id);
        setBusyOrderIds([...pending.current]);
        void refresh();
      }
    },
    [clearActionError, refresh, replaceOrders],
  );

  // The worker advances orders or rejects them with a reason; cancelling is the client's (§6).
  const handleOrderAction = useCallback(
    (order: Order) => mutate(order),
    [mutate],
  );

  /** B18: the error stays in the dialog that asked for it, not in the global alert. */
  const handleOrderReject = useCallback(
    async (
      order: Order,
      reason: string,
    ): Promise<{ order: Order } | { error: string }> => {
      if (pending.current.has(order.id))
        return { error: "Ya estamos procesando este pedido." };
      const current = latestOrders.current.find((item) => item.id === order.id);
      if (
        !current ||
        (current.status !== "pending" && current.status !== "preparing")
      )
        return {
          error:
            "El pedido cambió de estado y ya no se puede rechazar. Revisa el estado actualizado.",
        };
      pending.current.add(order.id);
      ++revision.current;
      setBusyOrderIds([...pending.current]);
      try {
        const updated = await rejectOrder(current, reason);
        replaceOrders(
          latestOrders.current.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        );
        return { order: updated };
      } catch (cause) {
        return {
          error:
            cause instanceof Error
              ? cause.message
              : "No se pudo rechazar el pedido.",
        };
      } finally {
        pending.current.delete(order.id);
        setBusyOrderIds([...pending.current]);
        void refresh();
      }
    },
    [refresh, replaceOrders],
  );

  /**
   * Reminder or "no recogido" of a CALLED order. It shares the per-order lock with the other
   * actions, so a double click or a click during another action sends nothing.
   */
  const handleCalledOrderAction = useCallback(
    async (order: Order, action: CalledOrderAction): Promise<Order | null> => {
      if (pending.current.has(order.id)) return null;
      clearActionError();
      const current = latestOrders.current.find((item) => item.id === order.id);
      if (!current || current.status !== "called") {
        setActionError(
          "El pedido ya cambió de estado. Revisa el tablero actualizado.",
        );
        void refresh();
        return null;
      }
      pending.current.add(order.id);
      ++revision.current;
      setBusyOrderIds([...pending.current]);
      setBusyActions((actions) => ({ ...actions, [order.id]: action }));
      try {
        const updated = await runCalledOrderAction(current, action);
        replaceOrders(
          latestOrders.current.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        );
        return updated;
      } catch (cause) {
        setActionError(
          cause instanceof Error
            ? cause.message
            : "No se pudo actualizar el pedido.",
        );
        return null;
      } finally {
        pending.current.delete(order.id);
        setBusyOrderIds([...pending.current]);
        setBusyActions((actions) => {
          const next = { ...actions };
          delete next[order.id];
          return next;
        });
        void refresh();
      }
    },
    [clearActionError, refresh, replaceOrders],
  );

  return {
    orders,
    loading,
    error,
    actionError,
    isPriorityError,
    busyOrderIds,
    busyActions,
    handleOrderAction,
    handleOrderReject,
    handleCalledOrderAction,
    clearActionError,
  };
}
