"use client";

import {
  Check,
  Megaphone,
  ShoppingBag,
  CupSoda,
  MessageSquareText,
  X,
} from "lucide-react";
import { formatClockTime } from "@/lib/orderTime";

import { SearchEmpty } from "@/features/orders/components/BoardFeedback";
import { clientIdentity } from "@/features/orders/utils/clientIdentity";
import { pickupLabel } from "@/features/orders/utils/pickupTime";
import {
  NotCollectedButton,
  RemindButton,
  ReminderLimitNotice,
} from "@/features/orders/components/CalledOrderActions";
import type { CalledOrderAction } from "@/features/orders/calledOrderActions";
import type { Order } from "@/types/order";
import { DailyMenuSummary } from "@/features/daily-menu/components/DailyMenuSummary";

import {
  PanelCounter,
  PanelHeader,
  panelStyles,
} from "@/features/worker-ui/components/PanelHeader";
import modernStyles from "./CallsBoard.module.css";
import classicStyles from "./CallsBoard.classic.module.css";
import { ICON_MIN_20 } from "@/components/ui/Icon";
import { ICON_MIN_16 } from "@/components/ui/Icon";

interface CallsBoardProps {
  /** Pedidos and Llamadas use the classic look (ola 2 · D2); the rest keep the modern one. */
  variant?: "classic" | "modern";
  orders: Order[];
  busyOrderIds: string[];
  busyActions: Record<string, CalledOrderAction>;
  now: number;
  selectedOrder: Order | null;

  search: string;

  onSearchChange: (value: string) => void;

  /** Clears the header search (W5). */
  onClearSearch?: () => void;

  onSelectOrder: (order: Order | null) => void;

  onDeliver: (order: Order) => void;

  onRemind: (order: Order) => void;

  onNotCollected: (order: Order) => void;
}

/* =========================================================
   UTILIDADES
   ========================================================= */

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "U";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("es-CO")}`;
}

/* =========================================================
   COMPONENTE
   ========================================================= */

export default function CallsBoard({
  variant = "modern",
  orders,
  busyOrderIds,
  busyActions,
  now,
  selectedOrder,
  search,
  onClearSearch,
  onSelectOrder,
  onDeliver,
  onRemind,
  onNotCollected,
}: CallsBoardProps) {
  const styles = variant === "classic" ? classicStyles : modernStyles;
  const totalUnits =
    selectedOrder?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const query = search.trim().toLowerCase();

  /*
   * El buscador es el del Header global.
   * No mostramos otro buscador aquí.
   */

  const filteredOrders = orders.filter((order) => {
    if (!query) {
      return true;
    }

    return (
      order.student.toLowerCase().includes(query) ||
      (order.clientCode ?? "").toLowerCase().includes(query) ||
      order.items.some((item) => item.name.toLowerCase().includes(query))
    );
  });

  return (
    <section className={`${styles.container} ${panelStyles.page}`}>
      <div className={styles.content}>
        {/* =================================================
            PANEL DE LLAMADAS
            ================================================= */}

        <section
          className={`${panelStyles.panel} ${styles.listPanel}`}
          aria-label="Llamadas"
        >
          {/* HEADER: the shared panel header (F4), also used by Historial and Disponibilidad. */}

          <PanelHeader
            level={1}
            icon={<Megaphone size={26} style={ICON_MIN_20} strokeWidth={1.9} />}
            title="Llamadas"
            aside={<PanelCounter>{orders.length}</PanelCounter>}
          />

          {/* LISTA */}

          <div className={styles.list}>
            {filteredOrders.length === 0 ? (
              query ? (
                <SearchEmpty
                  query={search}
                  scope="por entregar"
                  onClear={() => onClearSearch?.()}
                />
              ) : (
                // L2: say it, instead of an empty area.
                <div className={styles.empty} role="status">
                  <p className={styles.emptyText}>
                    No hay pedidos esperando entrega.
                  </p>
                </div>
              )
            ) : (
              filteredOrders.map((order) => {
                const selected = selectedOrder?.id === order.id;

                return (
                  <article
                    key={order.id}
                    className={`${styles.orderRow} ${
                      selected ? styles.selected : ""
                    }`}
                  >
                    {/* ESTUDIANTE */}

                    <button
                      type="button"
                      className={styles.studentButton}
                      onClick={() => onSelectOrder(order)}
                      aria-pressed={selected}
                    >
                      <div className={styles.avatar}>
                        {getInitials(order.student)}
                      </div>

                      <div className={styles.studentInfo}>
                        <strong id={`call-student-${order.id}`}>
                          {order.student}
                        </strong>

                        {clientIdentity(order) && (
                          <span>{clientIdentity(order)}</span>
                        )}
                      </div>
                    </button>

                    {/* AVISAR NUEVAMENTE */}

                    <RemindButton
                      order={order}
                      now={now}
                      className={styles.remindButton}
                      describedBy={`call-student-${order.id}`}
                      busy={busyOrderIds.includes(order.id)}
                      sending={busyActions[order.id] === "remind"}
                      onRemind={onRemind}
                    />

                    {/* VER PEDIDO */}

                    <button
                      type="button"
                      className={styles.viewButton}
                      onClick={() => onSelectOrder(order)}
                    >
                      <span>Ver pedido</span>

                      <span>→</span>
                    </button>

                    {/* D5: only once every reminder was sent, across the whole row. */}
                    <ReminderLimitNotice
                      order={order}
                      now={now}
                      className={styles.rowLimit}
                    />
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* =================================================
            PANEL DE DETALLE
            ================================================= */}

        <aside className={styles.detailPanel} aria-label="Detalle del pedido">
          {!selectedOrder ? (
            /* =================================================
               SIN PEDIDO SELECCIONADO
               ================================================= */

            <div className={styles.noSelection}>
              <div className={styles.detailIcon}>
                <ShoppingBag size={32} strokeWidth={1.7} />
              </div>

              <h2>Selecciona un pedido</h2>

              <p>
                Selecciona un estudiante para consultar los detalles de su
                pedido.
              </p>
            </div>
          ) : (
            /* =================================================
               PEDIDO SELECCIONADO
               ================================================= */

            <div className={styles.detail}>
              {/* D4: who and when on top, the products as a clear list, the total stands out
                  and the notes apart. Solid white, dark text. */}
              <header className={styles.detailHeader}>
                <div className={styles.detailHeading}>
                  <div className={styles.detailAvatar} aria-hidden="true">
                    {getInitials(selectedOrder.student)}
                  </div>
                  <div className={styles.detailStudentInfo}>
                    <h2>{selectedOrder.student}</h2>
                    <p>
                      {selectedOrder.calledAt && (
                        <span>
                          Llamado a las{" "}
                          <time dateTime={selectedOrder.calledAt}>
                            {formatClockTime(selectedOrder.calledAt)}
                          </time>
                        </span>
                      )}
                      {pickupLabel(selectedOrder.requestedPickupAt) && (
                        <span className={styles.pickupBadge}>
                          {pickupLabel(selectedOrder.requestedPickupAt)}
                        </span>
                      )}
                      {clientIdentity(selectedOrder) && (
                        <span>{clientIdentity(selectedOrder)}</span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={() => onSelectOrder(null)}
                  aria-label="Cerrar detalle"
                >
                  <X size={20} style={ICON_MIN_20} aria-hidden="true" />
                </button>
              </header>

              <div className={styles.detailBody}>
                <section
                  className={styles.productsSection}
                  aria-label="Productos del pedido"
                >
                  <DailyMenuSummary order={selectedOrder} />
                  {selectedOrder.items.length === 0 ? (
                    <p className={styles.emptyProducts}>
                      No hay productos registrados en este pedido.
                    </p>
                  ) : (
                    <ul className={styles.products}>
                      {selectedOrder.items.map((item, index) => (
                        <li
                          key={item.id ?? `${item.name}-${index}`}
                          className={styles.product}
                        >
                          <span className={styles.quantity}>
                            {item.quantity}
                            <span aria-hidden="true">×</span>
                            <span className={styles.srOnly}>
                              {item.quantity === 1
                                ? " unidad de"
                                : " unidades de"}
                            </span>
                          </span>
                          <div className={styles.productInfo}>
                            <h3>{item.name}</h3>
                            {item.beverageChoice && (
                              <p className={styles.beverage}>
                                <CupSoda
                                  size={20}
                                  style={ICON_MIN_20}
                                  aria-hidden="true"
                                />
                                {item.beverageChoice}
                              </p>
                            )}
                            {item.note && (
                              <p className={styles.productNote}>
                                <MessageSquareText
                                  size={20}
                                  style={ICON_MIN_20}
                                  aria-hidden="true"
                                />
                                {item.note}
                              </p>
                            )}
                          </div>
                          <strong className={styles.productPrice}>
                            {item.subtotal !== undefined
                              ? formatCurrency(item.subtotal)
                              : "—"}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.total}>
                    <span>
                      Total
                      <small>
                        {totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}
                      </small>
                    </span>
                    <strong>
                      {selectedOrder.total !== undefined
                        ? formatCurrency(selectedOrder.total)
                        : "No disponible"}
                    </strong>
                  </div>
                </section>
                {selectedOrder.note && (
                  <section className={styles.orderNote} aria-label="Notas">
                    <MessageSquareText
                      size={20}
                      style={ICON_MIN_20}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>Observaciones</strong>
                      <p>{selectedOrder.note}</p>
                    </div>
                  </section>
                )}
              </div>

              <footer className={styles.detailFooter}>
                <ReminderLimitNotice order={selectedOrder} now={now} />
                <button
                  type="button"
                  className={styles.deliverButton}
                  disabled={
                    busyOrderIds.includes(selectedOrder.id) ||
                    selectedOrder.status !== "called"
                  }
                  aria-busy={busyOrderIds.includes(selectedOrder.id)}
                  onClick={() => onDeliver(selectedOrder)}
                >
                  <Check
                    size={19}
                    style={ICON_MIN_16}
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <span>
                    {busyActions[selectedOrder.id] === undefined &&
                    busyOrderIds.includes(selectedOrder.id)
                      ? "Registrando entrega…"
                      : "Marcar como entregado"}
                  </span>
                </button>
                <NotCollectedButton
                  key={selectedOrder.id}
                  order={selectedOrder}
                  busy={busyOrderIds.includes(selectedOrder.id)}
                  sending={busyActions[selectedOrder.id] === "not-collected"}
                  onConfirm={onNotCollected}
                />
              </footer>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
