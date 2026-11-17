import { formatOrderDate, formatTotal, pickupLabel } from "../presentation";
import type { ClientOrder } from "../types";
import styles from "./ClientOrders.module.css";

/** Items, pickup time, note and total of an order: shared by «Mi pedido» and the history detail. */
export default function OrderSummary({
  order,
  showDate = false,
}: {
  order: ClientOrder;
  showDate?: boolean;
}) {
  const pickup = pickupLabel(order);
  return (
    <div className={styles.summary}>
      <p className={styles.place}>
        {order.cafeteria.name}
        {showDate && <span> · {formatOrderDate(order.createdAt)}</span>}
      </p>
      <ul className={styles.lines} aria-label="Productos del pedido">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            <span>
              {item.quantity}× {item.name}
            </span>
            <span>{formatTotal(item.subtotal)}</span>
          </li>
        ))}
      </ul>
      {(pickup || order.note) && (
        <dl className={styles.facts}>
          {pickup && (
            <div>
              <dt>Recogida</dt>
              <dd>{pickup.replace("Recoger a las ", "")}</dd>
            </div>
          )}
          {order.note && (
            <div>
              <dt>Tu nota</dt>
              <dd>{order.note}</dd>
            </div>
          )}
        </dl>
      )}
      <p className={styles.total}>
        <span>Total</span>
        <strong>{formatTotal(order.total)}</strong>
      </p>
      <p className={styles.cash}>
        Pagas en efectivo en caja; la cafetería confirma el total final.
      </p>
    </div>
  );
}
