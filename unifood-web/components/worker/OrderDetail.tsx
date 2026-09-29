"use client";

import {
  useEffect,
  useRef,
} from "react";

import {
  AlertTriangle,
  Clock3,
  X,
  ShoppingBag,
} from "lucide-react";

import type {
  Order,
} from "@/types/order";

import {
  formatRelativeTime,
} from "@/lib/orderTime";

import {
  ACTION_LABELS,
  canAdvanceOrder,
} from "@/lib/orderWorkflow";

import styles from "./OrderDetail.module.css";

interface OrderDetailProps {
  order: Order | null;
  busy?: boolean;
  onClose: () => void;
  onAction: (order: Order) => void;
}

const FOCUSABLE_SELECTOR = [
  "button",
  "[href]",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export default function OrderDetail({
  order,
  busy = false,
  onClose,
  onAction,
}: OrderDetailProps) {
  const modalRef =
    useRef<HTMLDivElement>(null);

  const closeRef =
    useRef<HTMLButtonElement>(null);

  const onCloseRef =
    useRef(onClose);

  useEffect(() => {
    onCloseRef.current =
      onClose;
  }, [onClose]);

  useEffect(() => {
    if (!order) {
      return;
    }

    const previouslyFocused =
      document.activeElement as
        | HTMLElement
        | null;

    closeRef.current?.focus();

    document.body.style.overflow =
      "hidden";

    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const modal =
        modalRef.current;

      if (!modal) {
        return;
      }

      const focusable =
        Array.from(
          modal.querySelectorAll<HTMLElement>(
            FOCUSABLE_SELECTOR
          )
        );

      if (
        focusable.length === 0
      ) {
        return;
      }

      const first =
        focusable[0];

      const last =
        focusable[
          focusable.length - 1
        ];

      const active =
        document.activeElement;

      if (
        event.shiftKey &&
        active === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        active === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );

      document.body.style.overflow =
        "";

      previouslyFocused?.focus();
    };
  }, [order]);

  if (!order) {
    return null;
  }

  const total =
    order.total ??
    order.items.reduce(
      (sum, item) =>
        sum +
        (item.subtotal ??
          (item.unitPrice ?? 0) *
            item.quantity),
      0
    );

  const actionLabel =
    ACTION_LABELS[order.status];

  return (
    <div
      ref={modalRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <aside
        className={styles.modal}
      >
        {/* Cerrar */}
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Cerrar detalles"
        >
          <X size={20} />
        </button>

        {/* Información del estudiante */}
        <div
          className={styles.header}
        >
          <div
            className={styles.avatar}
          >
            {order.student.charAt(
              0
            )}
          </div>

          <div>
            <h2 id="order-detail-title">
              {order.student}
            </h2>

            <p>
              ID: {order.studentId}
            </p>
          </div>
        </div>

        <div
          className={styles.divider}
        />

        {/* Detalles del pedido */}
        <section
          className={styles.section}
        >
          <div
            className={
              styles.sectionTitle
            }
          >
            <ShoppingBag size={17} />

            <h3>
              Detalles del pedido
            </h3>
          </div>

          <div
            className={styles.items}
          >
            {order.items.map(
              (item, index) => (
                <div
                  key={
                    item.id ??
                    `${item.name}-${index}`
                  }
                  className={
                    styles.item
                  }
                >
                  {/* Nombre y subtotal */}
                  <div
                    className={
                      styles.itemMain
                    }
                  >
                    <div
                      className={
                        styles.itemName
                      }
                    >
                      <strong>
                        {item.quantity} ×{" "}
                        {item.name}
                      </strong>
                    </div>

                    <span
                      className={
                        styles.itemSubtotal
                      }
                    >
                      $
                      {(
                        item.subtotal ??
                        (item.unitPrice ??
                          0) *
                          item.quantity
                      ).toLocaleString(
                        "es-CO"
                      )}
                    </span>
                  </div>

                  {/* Precio unitario */}
                  {item.unitPrice !==
                    undefined && (
                    <span
                      className={
                        styles.itemPrice
                      }
                    >
                      $
                      {item.unitPrice.toLocaleString(
                        "es-CO"
                      )}{" "}
                      c/u
                    </span>
                  )}

                  {/* Bebida */}
                  {item.beverageChoice && (
                    <span
                      className={
                        styles.itemExtra
                      }
                    >
                      Bebida:{" "}
                      {
                        item.beverageChoice
                      }
                    </span>
                  )}

                  {/* Nota específica */}
                  {item.note && (
                    <span
                      className={
                        styles.itemExtra
                      }
                    >
                      Nota: {item.note}
                    </span>
                  )}
                </div>
              )
            )}
          </div>

          {/* Total */}
          <div
            className={styles.total}
          >
            <span>Total</span>

            <strong>
              $
              {total.toLocaleString(
                "es-CO"
              )}
            </strong>
          </div>
        </section>

        {/* Observaciones generales */}
        {order.note && (
          <>
            <div
              className={
                styles.divider
              }
            />

            <section
              className={
                styles.section
              }
            >
              <div
                className={
                  styles.sectionTitle
                }
              >
                <AlertTriangle
                  size={17}
                />

                <h3>
                  Observaciones
                </h3>
              </div>

              <p
                className={
                  styles.note
                }
              >
                {order.note}
              </p>
            </section>
          </>
        )}

        <div
          className={styles.divider}
        />

        {/* Tiempo */}
        <section
          className={styles.timeInfo}
        >
          <Clock3 size={18} />

          <div>
            <span>
              Tiempo de pedido
            </span>

            <strong>
              {formatRelativeTime(
                order.createdAt
              )}
            </strong>
          </div>
        </section>

        {/* Acción */}
        <button
          type="button"
          className={styles.action}
          onClick={() =>
            onAction(order)
          }
          disabled={
            busy || !canAdvanceOrder(order)
          }
          aria-label={
            order.status ===
            "delivered"
              ? "Pedido entregado"
              : actionLabel
          }
        >
          <span>
            {actionLabel}
          </span>
        </button>
      </aside>
    </div>
  );
}
