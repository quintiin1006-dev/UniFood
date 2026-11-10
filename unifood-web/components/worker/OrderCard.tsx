"use client";

import {
  ArrowRight,
  UserRound,
} from "lucide-react";

import {
  ACTION_ICONS,
  ACTION_LABELS,
  canAdvanceOrder,
} from "@/lib/orderWorkflow";

import {
  formatClockTime,
  formatRelativeTime,
} from "@/lib/orderTime";

import { clientIdentity } from "@/features/orders/utils/clientIdentity";
import type { Order } from "@/types/order";

import styles from "./OrderCard.module.css";

interface OrderCardProps {
  order: Order;
  onOpen: (order: Order) => void;
  onAction: (order: Order) => void;
  busy?: boolean;
}

export default function OrderCard({
  order,
  onOpen,
  onAction,
  busy = false,
}: OrderCardProps) {
  const ActionIcon =
    ACTION_ICONS[order.status];

  const actionLabel =
    ACTION_LABELS[order.status];

  const identity = clientIdentity(order);

  const isDelivered =
    order.status === "delivered";

  return (
    <article
      className={`${styles.card} ${
        isDelivered
          ? styles.delivered
          : ""
      }`}
    >
      {/* Información principal del estudiante */}
      <button
        type="button"
        className={styles.mainInfo}
        onClick={() => onOpen(order)}
        aria-label={`Ver pedido de ${order.student}`}
      >
        <div className={styles.userIcon}>
          <UserRound
            size={18}
            strokeWidth={2.3}
          />
        </div>

        <div className={styles.student}>
          <strong>
            {order.student}
          </strong>

          {identity && <span>{identity}</span>}
        </div>

        <div className={styles.time}>
          {formatRelativeTime(
            order.createdAt
          )}
        </div>

        <ArrowRight
          size={21}
          strokeWidth={2.2}
          className={styles.arrow}
        />
      </button>

      {/* Estado del estudiante */}
      {order.status === "called" && (
        <div
          className={
            styles.calledStatus
          }
        >
          <span
            className={
              styles.calledDot
            }
          />

          <span>
            Estudiante avisado
          </span>
        </div>
      )}

      {/* Acción principal */}
      <button
        type="button"
        className={`${styles.actionButton} ${
          isDelivered
            ? styles.actionDisabled
            : ""
        }`}
        onClick={() =>
          onAction(order)
        }
        disabled={busy || !canAdvanceOrder(order)}
        aria-label={
          isDelivered
            ? "Pedido entregado"
            : actionLabel
        }
      >
        <ActionIcon
          size={18}
          strokeWidth={2.3}
        />

        <span>
          {actionLabel}
        </span>

        {isDelivered &&
          order.deliveredAt && (
            <span
              className={
                styles.deliveredTime
              }
            >
              ·{" "}
              {formatClockTime(
                order.deliveredAt
              )}
            </span>
          )}
      </button>
    </article>
  );
}
