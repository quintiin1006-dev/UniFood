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
          <p className={styles.eyebrow}>SEGUIMIENTO OPERATIVO</p>
          <h2 id="not-collected-products-title">Productos no recogidos</h2>
          <p>Unidades de productos en pedidos marcados como no recogidos.</p>
        </div>
        <span className={styles.badge}>Top {ranking.limit}</span>
      </div>
      <dl className={styles.impactGrid}>
        <div>
          <dt>Pedidos no recogidos</dt>
          <dd>{formatCount(summary.notCollectedOrders)}</dd>
        </div>
        <div>
          <dt>Unidades no recogidas</dt>
          <dd>{formatCount(summary.notCollectedUnits)}</dd>
        </div>
        <div>
          <dt>Valor asociado a pedidos</dt>
          <dd>{formatMoney(summary.notCollectedOrderValue)}</dd>
        </div>
      </dl>
      <p className={styles.hint}>
        El valor asociado es el importe registrado en los pedidos. El desglose
        utiliza los subtotales históricos de sus productos y puede diferir.
        Ninguno acredita dinero cobrado.
      </p>
      <ProductsRanking ranking={ranking} uncollected />
    </section>
  );
}
