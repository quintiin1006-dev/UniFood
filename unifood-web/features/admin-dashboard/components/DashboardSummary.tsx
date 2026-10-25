import type { DashboardSummary as Summary } from "../types";
import { formatCount, formatMoney, formatPercent } from "../presentation";
import styles from "./AdminDashboard.module.css";

export function DashboardSummary({ summary: s }: { summary: Summary }) {
  return (
    <section aria-labelledby="dashboard-summary-title">
      <h2 id="dashboard-summary-title" className={styles.sectionTitle}>
        Resumen del período
      </h2>
      <dl className={styles.countGrid}>
        {[
          ["Pedidos recibidos", s.receivedOrders],
          ["Pedidos entregados", s.deliveredOrders],
          ["Pedidos no recogidos", s.notCollectedOrders],
          ["Unidades no recogidas", s.notCollectedUnits],
        ].map(([label, value]) => (
          <div key={label} className={styles.metric}>
            <dt>{label}</dt>
            <dd>{formatCount(value)}</dd>
          </div>
        ))}
      </dl>
      <dl className={styles.valueGrid}>
        <div className={styles.metric}>
          <dt>Valor de pedidos registrados</dt>
          <dd>{formatMoney(s.receivedOrderValue)}</dd>
          <small>Incluye pedidos posteriormente cancelados.</small>
        </div>
        <div className={styles.metric}>
          <dt>Valor asociado a no recogidos</dt>
          <dd>{formatMoney(s.notCollectedOrderValue)}</dd>
          <small>Valor registrado de los pedidos, sin confirmar cobros.</small>
        </div>
        <div className={styles.metric}>
          <dt>Tasa de no recogida</dt>
          <dd>{formatPercent(s.notCollectedRatePercent)}</dd>
          <small>
            Entre {formatCount(s.notCollectedRateDenominator)} entregas y no
            recogidas registradas.
          </small>
        </div>
      </dl>
      <p className={styles.hint}>
        Tasa de no recogida = no recogidos ÷ (entregados + no recogidos) × 100.
        Los pedidos activos y cancelados quedan fuera de esta tasa.
      </p>
    </section>
  );
}
