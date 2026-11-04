import type { DashboardSummary as Summary } from "../types";
import { formatCount, formatMoney, formatPercent } from "../presentation";
import styles from "./AdminDashboard.module.css";
import { DashboardInfo } from "./DashboardInfo";

export function DashboardSummary({ summary: s }: { summary: Summary }) {
  return (
    <section aria-labelledby="dashboard-summary-title">
      <div className={styles.summaryHeading}>
        <h2 id="dashboard-summary-title" className={styles.sectionTitle}>
          Resumen del período
        </h2>
        <a href="#not-collected-products">Ver no recogidos</a>
      </div>
      <dl className={styles.countGrid}>
        {[
          ["Pedidos recibidos", s.receivedOrders],
          ["Pedidos entregados", s.deliveredOrders],
          ["Pedidos no recogidos", s.notCollectedOrders],
          ["Unidades no recogidas", s.notCollectedUnits],
        ].map(([label, value]) => (
          <div key={label} className={styles.metric}>
            <dt>{label}</dt>
            <dd className={value === null ? styles.metricUnknown : undefined}>
              {formatCount(value)}
            </dd>
          </div>
        ))}
        <div className={styles.metric}>
          <dt>
            <span>Tasa de no recogida</span>
            <DashboardInfo label="Cómo se calcula la tasa">
              <p>
                No recogidos ÷ (entregados + no recogidos) × 100. Excluye
                pedidos activos y cancelados.
              </p>
              <p>
                Base: {formatCount(s.notCollectedRateDenominator)} entregas y no
                recogidas registradas.
              </p>
            </DashboardInfo>
          </dt>
          <dd
            className={
              s.notCollectedRatePercent === null
                ? styles.metricUnknown
                : undefined
            }
          >
            {formatPercent(s.notCollectedRatePercent)}
          </dd>
          <small>Sobre pedidos finalizados</small>
        </div>
      </dl>
      <dl className={styles.monetarySummary}>
        <div>
          <dt>
            <span>Valor de pedidos registrados</span>
            <DashboardInfo label="Sobre el valor de pedidos registrados">
              <p>
                Importe registrado, incluidos pedidos cancelados. No acredita
                dinero cobrado.
              </p>
            </DashboardInfo>
          </dt>
          <dd>{formatMoney(s.receivedOrderValue)}</dd>
        </div>
      </dl>
    </section>
  );
}
