import { formatCount, formatPercent } from "../presentation";
import type { DashboardRanking, DashboardSummary as Summary } from "../types";
import { DashboardInfo } from "./DashboardInfo";
import { NotCollectedProducts } from "./NotCollectedProducts";
import styles from "./AdminDashboard.module.css";

/** «Ver más detalle»: rate, uncollected units and the uncollected products, collapsed by default. */
export function DashboardDetail({
  summary: s,
  ranking,
}: {
  summary: Summary;
  ranking: DashboardRanking;
}) {
  return (
    <details className={styles.moreDetail}>
      <summary>Ver más detalle</summary>
      <dl className={styles.countGrid}>
        <div className={styles.metric}>
          <dt>Unidades no recogidas</dt>
          <dd>{formatCount(s.notCollectedUnits)}</dd>
        </div>
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
        </div>
      </dl>
      <NotCollectedProducts ranking={ranking} summary={s} />
    </details>
  );
}
