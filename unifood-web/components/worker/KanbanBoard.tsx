"use client";

import { useState } from "react";
import {
  Clock3,
  ChefHat,
  ShoppingBag,
  Check,
  type LucideIcon,
} from "lucide-react";

import { NEW_ORDER_BADGE_MS } from "@/features/orders/listingStatus";
import type { Order } from "@/types/order";
import OrderCard from "./OrderCard";
import styles from "./KanbanBoard.module.css";

interface KanbanBoardProps {
  orders: Order[];
  busyOrderIds: string[];
  /** When each order first appeared after the first read (W11). */
  newOrderIds?: Record<string, number>;
  now: number;
  onOpenOrder: (order: Order) => void;
  onAction: (order: Order) => void;
  onReject?: (order: Order) => void;
}

interface Column {
  id: string;
  title: string;
  statuses: Order["status"][];
  icon: LucideIcon;
}

const columns: Column[] = [
  {
    id: "pending",
    title: "Pendientes",
    statuses: ["pending"],
    icon: Clock3,
  },
  {
    id: "preparing",
    title: "En preparación",
    statuses: ["preparing"],
    icon: ChefHat,
  },
  {
    id: "ready",
    title: "Listos para entregar",
    statuses: ["ready", "called"],
    icon: ShoppingBag,
  },
  {
    id: "delivered",
    title: "Entregados",
    statuses: ["delivered"],
    icon: Check,
  },
];

export default function KanbanBoard({
  orders,
  busyOrderIds,
  newOrderIds = {},
  now,
  onOpenOrder,
  onAction,
  onReject,
}: KanbanBoardProps) {
  // W9: an order animates only when it changed column while the board was on screen. On mount
  // (opening the module) there is no previous state, so nothing moves; a polling refresh that
  // changes nothing keeps the same set. Derived state, updated during render.
  const statuses = orders.map((order) => `${order.id}:${order.status}`).join();
  const [seen, setSeen] = useState<{
    key: string;
    byId: Record<string, string>;
  } | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  // Ola 2: a new order gets a brand-tint highlight once, under the same guard.
  const [appeared, setAppeared] = useState<ReadonlySet<string>>(new Set());
  if (seen?.key !== statuses) {
    // Cumulative, so an order hidden by the search and shown again is not «new».
    const byId = {
      ...(seen?.byId ?? {}),
      ...Object.fromEntries(orders.map((order) => [order.id, order.status])),
    };
    const moved = new Set(
      seen
        ? orders
            .filter(
              (order) =>
                seen.byId[order.id] !== undefined &&
                seen.byId[order.id] !== order.status,
            )
            .map((order) => order.id)
        : [],
    );
    const fresh = new Set(
      seen
        ? orders
            .filter((order) => seen.byId[order.id] === undefined)
            .map((order) => order.id)
        : [],
    );
    setSeen({ key: statuses, byId });
    setArrived(moved);
    setAppeared(fresh);
  }

  return (
    <section className={styles.board}>
      {columns.map((column) => {
        const columnOrders = orders.filter((order) =>
          column.statuses.includes(order.status),
        );

        // Every delivery of today, newest first; the column scrolls (owner's decision 9).
        const visibleOrders =
          column.id === "delivered"
            ? [...columnOrders].sort(
                (a, b) =>
                  new Date(b.deliveredAt ?? "").getTime() -
                  new Date(a.deliveredAt ?? "").getTime(),
              )
            : columnOrders;

        const ColumnIcon = column.icon;

        return (
          <article
            key={column.id}
            className={styles.column}
            data-tone={column.id}
          >
            <header className={styles.columnHeader}>
              <div className={styles.columnHeading}>
                <ColumnIcon
                  size={column.id === "delivered" ? 30 : 38}
                  strokeWidth={column.id === "delivered" ? 2.8 : 2.1}
                  className={
                    column.id === "delivered"
                      ? styles.deliveredIcon
                      : styles.columnIcon
                  }
                />

                <span className={styles.columnTitle}>{column.title}</span>
              </div>

              <span className={styles.columnCount}>{visibleOrders.length}</span>
            </header>

            <div className={styles.columnContent}>
              {visibleOrders.length === 0 ? (
                <div className={styles.emptyColumn}>No hay pedidos</div>
              ) : (
                visibleOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    busy={busyOrderIds.includes(order.id)}
                    arrived={arrived.has(order.id)}
                    appeared={appeared.has(order.id)}
                    isNew={
                      newOrderIds[order.id] !== undefined &&
                      now - newOrderIds[order.id] < NEW_ORDER_BADGE_MS
                    }
                    onOpen={() => onOpenOrder(order)}
                    onAction={() => onAction(order)}
                    onReject={onReject}
                  />
                ))
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
