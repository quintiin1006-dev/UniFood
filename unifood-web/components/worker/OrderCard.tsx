"use client";

import {
  ArrowRight,
  UserRound,
  XCircle,
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

import type { Order } from "@/types/order";

import styles from "./OrderCard.module.css";

interface OrderCardProps {
  order: Order;
  onOpen: (order: Order) => void;
  onAction: (order: Order) => void;
  onCancel: (order: Order) => void;
  busy?: boolean;
}

export default function OrderCard({
  order,
  onOpen,
  onAction,
  onCancel,
  busy = false,
}: OrderCardProps) {
  const ActionIcon =
    ACTION_ICONS[order.status];

  const actionLabel =
    ACTION_LABELS[order.status];

  const isPending =
    order.status === "pending";

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

          <span>
            ID: {order.studentId}
          </span>
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

      {/* Cancelar pedido */}
      {isPending && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCancel(order)
          }
          aria-label={`Cancelar pedido de ${order.student}`}
          style={{
            width: "100%",
            marginTop: "8px",
            border: "1px solid #fecaca",
            borderRadius: "12px",
            padding: "9px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
            background: "#fff7f7",
            color: "#dc2626",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <XCircle
            size={16}
            strokeWidth={2.2}
          />

          <span>
            Cancelar pedido
          </span>
        </button>
      )}
    </article>
  );
}
