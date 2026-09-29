"use client";

import {
  Bell,
  Check,
  Megaphone,
  ShoppingBag,
  CupSoda,
  MessageSquareText,
  X,
} from "lucide-react";

import type { Order } from "@/types/order";

import styles from "./CallsBoard.module.css";

interface CallsBoardProps {
  orders: Order[];
  busyOrderIds: string[];
  selectedOrder: Order | null;

  search: string;

  onSearchChange: (
    value: string
  ) => void;

  onSelectOrder: (
    order: Order | null
  ) => void;

  onDeliver: (
    order: Order
  ) => void;

  onRemind: (
    order: Order
  ) => void;
}

/* =========================================================
   UTILIDADES
   ========================================================= */

function getInitials(
  name: string
): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "U";
  }

  if (words.length === 1) {
    return words[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    words[0][0] +
    words[1][0]
  ).toUpperCase();
}

function formatCurrency(
  value: number
): string {
  return `$${value.toLocaleString(
    "es-CO"
  )}`;
}

/* =========================================================
   COMPONENTE
   ========================================================= */

export default function CallsBoard({
  orders,
  busyOrderIds,
  selectedOrder,
  search,
  onSelectOrder,
  onDeliver,
  onRemind,
}: CallsBoardProps) {
  const totalUnits = selectedOrder?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const query =
    search.trim().toLowerCase();

  /*
   * El buscador es el del Header global.
   * No mostramos otro buscador aquí.
   */

  const filteredOrders =
    orders.filter((order) => {
      if (!query) {
        return true;
      }

      return (
        order.student
          .toLowerCase()
          .includes(query) ||
        order.studentId
          .toLowerCase()
          .includes(query) ||
        order.items.some((item) =>
          item.name
            .toLowerCase()
            .includes(query)
        )
      );
    });

  return (
    <section className={styles.container}>
      <div className={styles.content}>

        {/* =================================================
            PANEL DE LLAMADAS
            ================================================= */}

        <section
          className={styles.listPanel}
          aria-label="Llamadas"
        >
          {/* HEADER */}

          <header className={styles.listHeader}>
            <div className={styles.headerIcon}>
              <Megaphone
                size={27}
                strokeWidth={1.9}
              />
            </div>

            <h1 className={styles.title}>
              Llamadas
            </h1>

            <div className={styles.counter}>
              {orders.length}
            </div>
          </header>

          {/* LISTA */}

          <div className={styles.list}>
            {filteredOrders.length === 0 ? (
              /*
               * Si no existen llamadas,
               * dejamos el área completamente vacía.
               */
              <div
                className={styles.empty}
                aria-hidden="true"
              />
            ) : (
              filteredOrders.map(
                (order) => {
                  const selected =
                    selectedOrder?.id ===
                    order.id;

                  return (
                    <article
                      key={order.id}
                      className={`${styles.orderRow} ${
                        selected
                          ? styles.selected
                          : ""
                      }`}
                    >
                      {/* ESTUDIANTE */}

                      <button
                        type="button"
                        className={
                          styles.studentButton
                        }
                        onClick={() =>
                          onSelectOrder(
                            order
                          )
                        }
                        aria-pressed={
                          selected
                        }
                      >
                        <div
                          className={
                            styles.avatar
                          }
                        >
                          {getInitials(
                            order.student
                          )}
                        </div>

                        <div
                          className={
                            styles.studentInfo
                          }
                        >
                          <strong>
                            {order.student}
                          </strong>

                          <span>
                            ID:{" "}
                            {
                              order.studentId
                            }
                          </span>
                        </div>
                      </button>

                      {/* AVISAR NUEVAMENTE */}

                      <button
                        type="button"
                        className={
                          styles.remindButton
                        }
                        onClick={() =>
                          onRemind(order)
                        }
                        aria-label={`Avisar nuevamente a ${order.student}`}
                          disabled
                          title="Recordatorios aún no disponibles"
                      >
                        <Bell
                          size={18}
                          strokeWidth={2}
                        />
                      </button>

                      {/* VER PEDIDO */}

                      <button
                        type="button"
                        className={
                          styles.viewButton
                        }
                        onClick={() =>
                          onSelectOrder(
                            order
                          )
                        }
                      >
                        <span>
                          Ver pedido
                        </span>

                        <span>
                          →
                        </span>
                      </button>
                    </article>
                  );
                }
              )
            )}
          </div>
        </section>

        {/* =================================================
            PANEL DE DETALLE
            ================================================= */}

        <aside
          className={styles.detailPanel}
          aria-label="Detalle del pedido"
        >
          {!selectedOrder ? (
            /* =================================================
               SIN PEDIDO SELECCIONADO
               ================================================= */

            <div
              className={
                styles.noSelection
              }
            >
              <div
                className={
                  styles.detailIcon
                }
              >
                <ShoppingBag
                  size={32}
                  strokeWidth={1.7}
                />
              </div>

              <h2>
                Selecciona un pedido
              </h2>

              <p>
                Selecciona un estudiante
                para consultar los
                detalles de su pedido.
              </p>
            </div>
          ) : (
            /* =================================================
               PEDIDO SELECCIONADO
               ================================================= */

            <div className={styles.detail}>
              <header className={styles.detailHeader}>
                <div className={styles.detailHeading}>
                  <div className={styles.headingIcon}><ShoppingBag size={22} aria-hidden="true" /></div>
                  <div>
                    <small>RESUMEN PARA ENTREGA</small>
                    <h2>Detalle del pedido</h2>
                  </div>
                </div>
                <button type="button" className={styles.closeButton}
                  onClick={() => onSelectOrder(null)} aria-label="Cerrar detalle">
                  <X size={19} />
                </button>
              </header>

              <div className={styles.detailBody}>
                <div className={styles.studentDetail}>
                  <div className={styles.detailAvatar}>{getInitials(selectedOrder.student)}</div>
                  <div className={styles.detailStudentInfo}>
                    <small>ENTREGAR A</small>
                    <strong>{selectedOrder.student}</strong>
                    <span>ID: {selectedOrder.studentId || "No registrado"}</span>
                  </div>
                  {selectedOrder.status === "called" && (
                    <span className={styles.calledBadge}><Check size={13} aria-hidden="true" /> Avisado</span>
                  )}
                </div>

                <section className={styles.productsSection} aria-label="Productos del pedido">
                  <div className={styles.productsHeader}>
                    <h3>Lo que pidió</h3>
                    <span>{totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}</span>
                  </div>
                  <div className={styles.products}>
                    {selectedOrder.items.length === 0 && (
                      <p className={styles.emptyProducts}>No hay productos registrados en este pedido.</p>
                    )}
                    {selectedOrder.items.map((item, index) => (
                      <article key={item.id ?? `${item.name}-${index}`} className={styles.product}>
                        <div className={styles.quantity} aria-label={`Cantidad: ${item.quantity}`}>
                          <strong>{item.quantity}</strong><span>cant.</span>
                        </div>
                        <div className={styles.productInfo}>
                          <h4>{item.name}</h4>
                          {item.unitPrice !== undefined && (
                            <p className={styles.unitPrice}>{formatCurrency(item.unitPrice)} por unidad</p>
                          )}
                          {item.beverageChoice && (
                            <div className={styles.beverage}>
                              <CupSoda size={16} aria-hidden="true" />
                              <div><span>Bebida elegida</span><strong>{item.beverageChoice}</strong></div>
                            </div>
                          )}
                          {item.note && (
                            <div className={styles.productNote}>
                              <MessageSquareText size={15} aria-hidden="true" />
                              <div><span>Indicaciones</span><p>{item.note}</p></div>
                            </div>
                          )}
                          <div className={styles.productPrice}>
                            <span>Subtotal</span>
                            <strong>{item.subtotal !== undefined ? formatCurrency(item.subtotal) : "No disponible"}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {selectedOrder.note && (
                    <div className={styles.orderNote}>
                      <MessageSquareText size={18} aria-hidden="true" />
                      <div><strong>Nota del pedido</strong><p>{selectedOrder.note}</p></div>
                    </div>
                  )}
                </section>
              </div>

              <footer className={styles.detailFooter}>
                <div className={styles.total}>
                  <span>Total del pedido<small>Pesos colombianos · COP</small></span>
                  <strong>{selectedOrder.total !== undefined ? formatCurrency(selectedOrder.total) : "No disponible"}</strong>
                </div>
                <button type="button" className={styles.deliverButton}
                  disabled={busyOrderIds.includes(selectedOrder.id) || selectedOrder.status !== "called"}
                  aria-busy={busyOrderIds.includes(selectedOrder.id)}
                  onClick={() => onDeliver(selectedOrder)}>
                  <Check size={19} strokeWidth={2.5} aria-hidden="true" />
                  <span>{busyOrderIds.includes(selectedOrder.id) ? "Registrando entrega…" : "Marcar como entregado"}</span>
                </button>
              </footer>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
