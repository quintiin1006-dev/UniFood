"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  formatHistoryDate,
  formatHistoryPrice,
  formatHistoryTime,
  historyStatusText,
} from "../presentation";
import type { HistoryOrder } from "../types";
import styles from "./WorkerHistory.module.css";

/**
 * One finished order in the history list: name and hour on the left, a toggle on the right.
 * The state is shown only inside the detail (jj/cliente-ajustes · A2).
 */
export function HistoryOrderRow({
  order,
  defaultOpen = false,
}: {
  order: HistoryOrder;
  /** Starts expanded; used by the tests to render the detail. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const name = order.clientName || "Cliente no disponible";
  return (
    <article className={styles.row} data-open={open || undefined}>
      <div className={styles.rowHead}>
        <div className={styles.rowIdentity}>
          <h3 className={styles.rowName}>{name}</h3>
          {/* The hour it ended; the order id is not shown (jj/cliente-pulido). */}
          <time dateTime={order.completedAt}>
            {formatHistoryTime(order.completedAt)}
          </time>
        </div>
        <div className={styles.rowAside}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Ocultar" : "Ver"} detalle del pedido de ${name}`}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">{open ? "Ocultar" : "Ver detalle"}</span>
            <ChevronDown
              size={18}
              strokeWidth={2.2}
              aria-hidden="true"
              className={styles.chevron}
            />
          </button>
        </div>
      </div>
      {open && (
        <div className={styles.detailWrap}>
          <div id={panelId} className={styles.detail}>
            <p className={styles.detailStatus}>
              {historyStatusText(order)} ·{" "}
              <time dateTime={order.completedAt}>
                {formatHistoryDate(order.completedAt)} ·{" "}
                {formatHistoryTime(order.completedAt)}
              </time>
            </p>
            {order.items.length > 0 ? (
              <ul
                className={styles.items}
                aria-label={`Productos del pedido de ${name}`}
              >
                {order.items.map((item, index) => (
                  <li key={index}>
                    <span className={styles.itemName}>
                      <span className={styles.quantity}>{item.quantity}×</span>{" "}
                      <span>{item.name}</span>
                    </span>
                    <span className={styles.amount}>
                      {formatHistoryPrice(item.subtotal)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.noItems}>
                Sin detalle de productos registrado.
              </p>
            )}
            <div className={styles.total}>
              <span>Total</span>
              <strong>{formatHistoryPrice(order.total)}</strong>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
