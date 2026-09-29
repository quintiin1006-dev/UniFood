"use client";

import {
  Clock3,
  ChefHat,
  ShoppingBag,
  Check,
  type LucideIcon,
} from "lucide-react";

import type { Order } from "@/types/order";
import OrderCard from "./OrderCard";
import styles from "./KanbanBoard.module.css";

interface KanbanBoardProps {
  orders: Order[];
  busyOrderIds: string[];
  onOpenOrder: (order: Order) => void;
  onAction: (order: Order) => void;
  onCancel: (order: Order) => void;
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
  onOpenOrder,
  onAction,
  onCancel,
}: KanbanBoardProps) {
  return (
    <section className={styles.board}>
      {columns.map((column) => {
        const columnOrders = orders.filter(
          (order) =>
            column.statuses.includes(
              order.status
            )
        );

        const visibleOrders =
          column.id === "delivered"
            ? [...columnOrders]
                .sort(
                  (a, b) =>
                    new Date(
                      b.updatedAt
                    ).getTime() -
                    new Date(
                      a.updatedAt
                    ).getTime()
                )
                .slice(0, 5)
            : columnOrders;

        const ColumnIcon = column.icon;

        return (
          <article
            key={column.id}
            className={styles.column}
          >
            <header
              className={
                styles.columnHeader
              }
            >
              <div
                className={
                  styles.columnHeading
                }
              >
                <ColumnIcon
                  size={
                    column.id ===
                    "delivered"
                      ? 30
                      : 38
                  }
                  strokeWidth={
                    column.id ===
                    "delivered"
                      ? 2.8
                      : 2.1
                  }
                  className={
                    column.id ===
                    "delivered"
                      ? styles.deliveredIcon
                      : styles.columnIcon
                  }
                />

                <span
                  className={
                    styles.columnTitle
                  }
                >
                  {column.title}
                </span>
              </div>

              <span
                className={
                  styles.columnCount
                }
              >
                {visibleOrders.length}
              </span>
            </header>

            <div
              className={
                styles.columnContent
              }
            >
              {visibleOrders.length === 0 ? (
                <div
                  className={
                    styles.emptyColumn
                  }
                >
                  No hay pedidos
                </div>
              ) : (
                visibleOrders.map(
                  (order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      busy={busyOrderIds.includes(order.id)}
                      onOpen={() =>
                        onOpenOrder(order)
                      }
                      onAction={() =>
                        onAction(order)
                      }
                      onCancel={() =>
                        onCancel(order)
                      }
                    />
                  )
                )
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
