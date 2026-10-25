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
        <p>
          Faltan detalles de productos completos y fiables en algunos pedidos.
          No se muestra un Top parcial como resultado definitivo.
        </p>
      </div>
    );
  return (
    <>
      <p className={styles.rankingTotals}>
        Universo completo:{" "}
        <strong>
          {formatCount(ranking.totals.products)}{" "}
          {ranking.totals.products === "1" ? "producto" : "productos"}
        </strong>{" "}
        · {formatCount(ranking.totals.orders)} pedidos distintos ·{" "}
        {formatCount(ranking.totals.units)} unidades ·{" "}
        {formatMoney(ranking.totals.itemValue)}
      </p>
      {ranking.items.length === 0 ? (
        <p className={styles.empty}>
          Sin unidades {uncollected ? "no recogidas" : "entregadas"}{" "}
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
              <caption>
                {label}: Top {ranking.limit} por unidades
              </caption>
              <thead>
                <tr>
                  <th scope="col">Producto histórico</th>
                  <th scope="col">Unidades</th>
                  <th scope="col">
                    Pedidos {uncollected ? "afectados" : "distintos"}
                  </th>
                  <th scope="col">Valor histórico</th>
                  {uncollected && <th scope="col">Participación</th>}
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
                    <td>{formatCount(p.units)}</td>
                    <td>{formatCount(p.orders)}</td>
                    <td>{formatMoney(p.itemValue)}</td>
                    {uncollected && (
                      <td>{formatPercent(p.unitSharePercent)}</td>
                    )}
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
        <p className={styles.hint}>
          La participación usa todas las unidades no recogidas, incluidas las de
          productos fuera del Top. Un pedido puede aparecer en varios productos;
          sus conteos no se suman.
        </p>
      )}
    </>
  );
}
