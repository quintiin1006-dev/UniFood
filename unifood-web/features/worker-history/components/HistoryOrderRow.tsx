"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  formatHistoryDate,
  formatHistoryPrice,
  formatHistoryTime,
  historyStatusText,
} from "../presentation";
import type { HistoryOrder } from "../types";
import styles from "./WorkerHistory.module.css";

/**
 * One finished order in the history list (ola 2 · D3): name and order id on the left, a compact
 * state chip and a toggle on the right. The toggle opens every detail the page has. The chip is
 * one element to remove if the owner does not want it (see docs/ui-paneles.md).
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
          <span>{order.reference}</span>
        </div>
        <div className={styles.rowAside}>
          <StatusChip
            status={order.status}
            cancellationSource={order.cancellationSource}
            className={styles.compactChip}
          />
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
        <div id={panelId} className={styles.detail}>
          <p className={styles.detailStatus}>
            {historyStatusText(order)} ·{" "}
            <time dateTime={order.completedAt} title="Hora de Bogotá">
              {formatHistoryDate(order.completedAt)} ·{" "}
              {formatHistoryTime(order.completedAt)}
            </time>
          </p>
          {order.items.length > 0 ? (
            <ul
              className={styles.items}
              aria-label={`Productos de ${order.reference}`}
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
      )}
    </article>
  );
}
