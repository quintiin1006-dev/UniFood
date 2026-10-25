import type { DashboardRanking } from "../types";
import { ProductsRanking } from "./ProductsRanking";
import styles from "./AdminDashboard.module.css";

export function DeliveredProductsRanking({
  ranking,
}: {
  ranking: DashboardRanking;
}) {
  return (
    <section
      className={styles.panel}
      aria-labelledby="delivered-products-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <h2 id="delivered-products-title">Productos más entregados</h2>
          <p>Unidades entregadas y valor histórico de sus productos.</p>
        </div>
        <span className={styles.badge}>Top {ranking.limit}</span>
      </div>
      <ProductsRanking ranking={ranking} />
    </section>
  );
}
