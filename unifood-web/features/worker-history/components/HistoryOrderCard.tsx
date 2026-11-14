import { Check, Clock3, X } from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import type { HistoryOrder } from "../types";
import {
  historyStatusText,
  formatHistoryPrice,
  formatHistoryTime,
  formatHistoryDate,
} from "../presentation";
import styles from "./WorkerHistory.module.css";

const icons = { DELIVERED: Check, NOT_COLLECTED: Clock3, CANCELLED: X };
export function HistoryOrderCard({ order }: { order: HistoryOrder }) {
  const Icon = icons[order.status];
  return (
    <article
      className={styles.card}
      aria-labelledby={`history-order-${order.id}`}
    >
      <div className={styles.cardHeading}>
        <h3 id={`history-order-${order.id}`}>{order.reference}</h3>
        <time dateTime={order.completedAt} title="Hora de Bogotá">
          {formatHistoryDate(order.completedAt)} ·{" "}
          {formatHistoryTime(order.completedAt)}
        </time>
      </div>
      {/* The shared state chip (ola 2); the text is the same fixed one as before. */}
      <StatusChip
        status={order.status}
        cancellationSource={order.cancellationSource}
        className={styles.badge}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{historyStatusText(order)}</span>
      </StatusChip>
      <p className={styles.clientName}>
        <span>Cliente</span>
        <strong>{order.clientName || "Cliente no disponible"}</strong>
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
                {item.name}
              </span>
              <span className={styles.amount}>
                {formatHistoryPrice(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noItems}>Sin detalle de productos registrado.</p>
      )}
      <div className={styles.total}>
        <span>Total</span>
        <strong>{formatHistoryPrice(order.total)}</strong>
      </div>
    </article>
  );
}
