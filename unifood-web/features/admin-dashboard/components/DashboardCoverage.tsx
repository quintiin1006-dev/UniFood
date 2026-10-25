import type { DashboardCoverage as Coverage } from "../types";
import { coverageScope, formatCount, warningText } from "../presentation";
import styles from "./AdminDashboard.module.css";

const checkLabels = {
  TERMINAL_DATE_VALIDITY: "Fechas de finalización",
  HEADER_AMOUNT_VALIDITY: "Importes de pedidos",
  ITEM_INTEGRITY: "Detalle de productos",
  HEADER_ITEM_RECONCILIATION: "Coincidencia de importes",
  HISTORICAL_NAME: "Nombres históricos",
  UNDATED_TERMINALS: "Pedidos históricos sin fecha",
};
export function DashboardCoverage({ coverage }: { coverage: Coverage }) {
  const anomalies = coverage.checks.some((check) => check.status === "WARN");
  return (
    <aside
      className={styles.coverage}
      aria-labelledby="dashboard-coverage-title"
    >
      <h2 id="dashboard-coverage-title">Cobertura limitada</h2>
      <p>
        Los resultados reflejan registros verificables. La procedencia de los
        pedidos y la revisión de todo el histórico no están certificadas.
      </p>
      <details open={anomalies}>
        <summary>
          {anomalies
            ? "Hay datos incompletos: revisar advertencias y alcance"
            : "Consultar advertencias y alcance de las comprobaciones"}
        </summary>
        <ul>
          {coverage.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`}>{warningText(w.code)}</li>
          ))}
        </ul>
        <div
          className={styles.tableScroll}
          role="region"
          aria-label="Alcance de la cobertura"
          tabIndex={0}
        >
          <table>
            <caption>Comprobaciones de cobertura</caption>
            <thead>
              <tr>
                <th scope="col">Comprobación</th>
                <th scope="col">Alcance</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {coverage.checks.map((check, i) => (
                <tr key={`${check.code}-${i}`}>
                  <th scope="row">{checkLabels[check.code]}</th>
                  <td>{coverageScope(check)}</td>
                  <td>
                    {check.status === "NOT_CHECKED"
                      ? "No comprobado"
                      : check.examinedOrders === "0"
                        ? "Sin pedidos examinables en este alcance"
                        : check.status === "WARN"
                          ? `${formatCount(check.affectedOrders)} de ${formatCount(check.examinedOrders)} pedidos requieren atención`
                          : `Sin incidencias entre ${formatCount(check.examinedOrders)} pedidos examinados`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.hint}>
          Una comprobación sin incidencias solo describe los pedidos examinados
          en ese alcance. No garantiza que todo el histórico esté completo. Un
          indicador «No calculable» no equivale a cero.
        </p>
      </details>
    </aside>
  );
}
