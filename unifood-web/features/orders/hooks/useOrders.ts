"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceOrder,
  cancelOrder,
  getOperationalOrders,
} from "@/features/orders/api/orderApi";
import type { Order } from "@/types/order";

export function useOrders(enabled = true) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPriorityError, setIsPriorityError] = useState(false);
  const [busyOrderIds, setBusyOrderIds] = useState<string[]>([]);
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
    async (order: Order, cancel: boolean): Promise<Order | null> => {
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
        const updated = await (cancel
          ? cancelOrder(current)
          : advanceOrder(current));
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
          !cancel &&
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

  const handleOrderAction = useCallback(
    (order: Order) => mutate(order, false),
    [mutate],
  );
  const handleOrderCancel = useCallback(
    (order: Order) => mutate(order, true),
    [mutate],
  );

  return {
    orders,
    loading,
    error,
    actionError,
    isPriorityError,
    busyOrderIds,
    handleOrderAction,
    handleOrderCancel,
    clearActionError,
  };
}
