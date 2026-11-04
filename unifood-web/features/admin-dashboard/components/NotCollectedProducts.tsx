import type { DashboardRanking, DashboardSummary } from "../types";
import { formatCount, formatMoney } from "../presentation";
import { ProductsRanking } from "./ProductsRanking";
import styles from "./AdminDashboard.module.css";

export function NotCollectedProducts({
  ranking,
  summary,
}: {
  ranking: DashboardRanking;
  summary: DashboardSummary;
}) {
  return (
    <section
      id="not-collected-products"
      className={`${styles.panel} ${styles.notCollected}`}
      aria-labelledby="not-collected-products-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <h2 id="not-collected-products-title">Productos no recogidos</h2>
          <p>Productos con más unidades sin recoger</p>
        </div>
        <span className={styles.badge}>Top {ranking.limit}</span>
      </div>
      <dl className={styles.impactGrid}>
        <div>
          <dt>Valor asociado a pedidos no recogidos</dt>
          <dd>{formatMoney(summary.notCollectedOrderValue)}</dd>
        </div>
        <div>
          <dt>Productos distintos afectados</dt>
          <dd>{formatCount(ranking.totals.products)}</dd>
        </div>
      </dl>
      <details className={styles.metricHelp}>
        <summary>Sobre los valores registrados</summary>
        <p>
          El valor asociado es el importe registrado en los pedidos. El desglose
          utiliza los subtotales históricos de sus productos y puede diferir.
          Ninguno acredita dinero cobrado.
        </p>
      </details>
      <ProductsRanking ranking={ranking} uncollected />
    </section>
  );
}
