import {
  DAILY_MENU_ORDER_LABEL,
  DAILY_MENU_ORDER_TOTAL,
  dailyMenuOrderAddition,
} from "@/features/shared/messages";
import { showsTotal } from "@/features/orders/utils/detailPricing";
import { plateSummary, readPrice, type OrderPlate } from "../orderSummary";
import { formatPrice } from "../presentation";
import styles from "./DailyMenuSummary.module.css";

/**
 * The plate of an order as a kitchen ticket (docs/propuesta-menu-dinamico.md 4.7): the dish and
 * its price, one line per category («Ninguna» included) and the additions together. Read only,
 * the same on the worker's card, detail and Llamadas and on the client's «Mi pedido». Without a
 * plate it draws nothing, so old orders look exactly as before.
 *
 * `withTotal`: the worker's detail shows its total only for several lines; with a plate the
 * order's total is shown here instead whenever the detail would hide it. With a service fee
 * (033) the detail always shows «Total a cobrar» itself, so it is not repeated here.
 */
export function DailyMenuSummary({
  order,
  withTotal = false,
}: {
  order: {
    dailyMenu?: OrderPlate | null;
    total?: number | string;
    serviceFee?: number;
    items: { quantity: number }[];
  };
  withTotal?: boolean;
}) {
  if (!order.dailyMenu) return null;
  const summary = plateSummary(order.dailyMenu);
  const total = readPrice(order.total);
  return (
    <section className={styles.summary} aria-label={DAILY_MENU_ORDER_LABEL}>
      <p className={styles.heading}>
        <strong>{summary.title}</strong>
        <span>{formatPrice(summary.price)}</span>
      </p>
      <dl className={styles.lines}>
        {summary.lines.map((line, index) => (
          <div key={`${line.category}-${index}`} className={styles.line}>
            <dt>{line.category}:</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
        {summary.additions && (
          <div className={styles.line}>
            <dt>{summary.additions.category}:</dt>
            <dd>
              {summary.additions.items
                .map(({ label, extraPrice }) =>
                  dailyMenuOrderAddition(label, formatPrice(extraPrice)),
                )
                .join(", ")}
            </dd>
          </div>
        )}
      </dl>
      {withTotal &&
        total !== null &&
        !showsTotal(order.items) &&
        !((order.serviceFee ?? 0) > 0) && (
          <p className={styles.total}>
            <span>{DAILY_MENU_ORDER_TOTAL}</span>
            <strong>{formatPrice(total)}</strong>
          </p>
        )}
    </section>
  );
}
