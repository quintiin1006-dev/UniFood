import { currency } from "../domain/catalog";
import styles from "./ClientCheckout.module.css";

type Line = { id?: string; name: string; quantity: number; unitPrice: number };

export default function CheckoutLines({ lines }: { lines: Line[] }) {
  return (
    <ul className={styles.lines} aria-label="Productos del pedido">
      {lines.map((line, index) => (
        <li key={line.id ?? `${line.name}-${index}`}>
          <div>
            <strong>
              {line.quantity} × {line.name}
            </strong>
            <p>{currency.format(line.unitPrice)} por unidad</p>
          </div>
          <span>{currency.format(line.quantity * line.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}
