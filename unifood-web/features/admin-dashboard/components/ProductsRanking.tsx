import type { DashboardRanking } from "../types";
import { formatCount, formatMoney, formatPercent } from "../presentation";
import styles from "./AdminDashboard.module.css";

export function ProductsRanking({
  ranking,
  uncollected = false,
}: {
  ranking: DashboardRanking;
  uncollected?: boolean;
}) {
  const label = uncollected ? "Productos no recogidos" : "Productos entregados";
  if (ranking.availability === "UNAVAILABLE_INCOMPLETE_ITEMS")
    return (
      <div className={styles.unavailable}>
        <strong>Ranking no disponible</strong>
        <p>Faltan detalles fiables para mostrar el Top completo.</p>
      </div>
    );
  return (
    <>
      <p className={styles.rankingTotals}>
        Total del período:{" "}
        {!uncollected && (
          <>
            <strong>
              {formatCount(ranking.totals.products)}{" "}
              {ranking.totals.products === "1" ? "producto" : "productos"}
            </strong>{" "}
            ·{" "}
          </>
        )}
        {formatCount(ranking.totals.orders)}{" "}
        {ranking.totals.orders === "1"
          ? "pedido distinto"
          : "pedidos distintos"}{" "}
        · {formatCount(ranking.totals.units)}{" "}
        {ranking.totals.units === "1" ? "unidad" : "unidades"} ·{" "}
        {formatMoney(ranking.totals.itemValue)} en productos
      </p>
      {ranking.items.length === 0 ? (
        <p className={styles.empty}>
          Sin productos {uncollected ? "no recogidos" : "entregados"}{" "}
          verificables en este período.
        </p>
      ) : (
        <>
          <div
            className={styles.tableScroll}
            role="region"
            aria-label={`Tabla de ${label.toLowerCase()}`}
            tabIndex={0}
          >
            <table>
              <caption className={styles.tableCaption}>
                {label}: Top {ranking.limit} por unidades
              </caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Unidades</th>
                  {uncollected && <th scope="col">Participación</th>}
                  <th scope="col">Pedidos distintos</th>
                  <th scope="col">
                    {uncollected
                      ? "Valor histórico asociado"
                      : "Valor asociado"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranking.items.map((p, index) => (
                  <tr key={p.productId}>
                    <th scope="row">
                      <span
                        className={styles.rankNumber}
                        aria-label={`Posición ${index + 1}`}
                      >
                        {index + 1}
                      </span>
                      {p.historicalName ?? "Nombre histórico no disponible"}
                    </th>
                    <td className={styles.priorityCell}>
                      {formatCount(p.units)}
                    </td>
                    {uncollected && (
                      <td className={styles.priorityCell}>
                        <span className={styles.shareCell}>
                          {p.unitSharePercent !== null && (
                            <span
                              className={styles.shareTrack}
                              aria-hidden="true"
                            >
                              <span
                                style={{ width: p.unitSharePercent + "%" }}
                              />
                            </span>
                          )}
                          {formatPercent(p.unitSharePercent)}
                        </span>
                      </td>
                    )}
                    <td>{formatCount(p.orders)}</td>
                    <td>{formatMoney(p.itemValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.mobileHint}>
            Puedes desplazar la tabla horizontalmente para ver todas las
            columnas.
          </p>
        </>
      )}
      {ranking.hasMore && (
        <p className={styles.omitted}>
          Fuera del Top {ranking.limit}: {formatCount(ranking.omitted.products)}{" "}
          {ranking.omitted.products === "1" ? "producto" : "productos"} ·{" "}
          {formatCount(ranking.omitted.units)} unidades ·{" "}
          {formatMoney(ranking.omitted.itemValue)}.
        </p>
      )}
      {uncollected && (
        <details className={styles.metricHelp}>
          <summary>Cómo interpretar la participación</summary>
          <p>
            La participación usa todas las unidades no recogidas, incluidas las
            de productos fuera del Top. Un pedido puede aparecer en varios
            productos; sus conteos no se suman.
          </p>
        </details>
      )}
    </>
  );
}
