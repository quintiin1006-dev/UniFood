import { formatCount, formatMoney } from "../presentation";
import type { DashboardSummary as Summary } from "../types";
import styles from "./AdminDashboard.module.css";

/**
 * «Simple y útil» (ola 2 · D4): three large counts and the amount registered. Rate and uncollected
 * units move to the collapsible detail (DashboardDetail).
 */
export function DashboardSummary({ summary: s }: { summary: Summary }) {
  return (
    <section
      aria-labelledby="dashboard-summary-title"
      className={styles.headline}
    >
      <h2 id="dashboard-summary-title" className={styles.sectionTitle}>
        Resumen del período
      </h2>
      <dl className={styles.bigGrid}>
        {[
          ["Pedidos recibidos", s.receivedOrders],
          ["Pedidos entregados", s.deliveredOrders],
          ["Pedidos no recogidos", s.notCollectedOrders],
        ].map(([label, value]) => (
          <div key={label} className={styles.bigMetric}>
            <dt>{label}</dt>
            <dd className={value === null ? styles.metricUnknown : undefined}>
              {formatCount(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.amountLine}>
        <span>Valor de pedidos registrados</span>
        <strong>{formatMoney(s.receivedOrderValue)}</strong>
      </p>
    </section>
  );
}
