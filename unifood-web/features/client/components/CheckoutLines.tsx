import { currency } from "../domain/catalog";
import type { CheckoutSummary } from "../domain/checkout";
import styles from "./ClientCheckout.module.css";

export default function CheckoutLines({
  lines,
}: {
  lines: CheckoutSummary["lines"];
}) {
  return (
    <ul className={styles.lines} aria-label="Platos del pedido">
      {lines.map((line) => (
        <li key={line.id}>
          <div>
            <strong>
              {line.quantity} × {line.name}
            </strong>
            <p>{currency.format(line.unitPrice)} por plato</p>
            {line.notes && <p className={styles.lineNotes}>{line.notes}</p>}
          </div>
          <span>{currency.format(line.quantity * line.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}
