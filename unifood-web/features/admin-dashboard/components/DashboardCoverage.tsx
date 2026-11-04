import type {
  DashboardCoverage as Coverage,
  DashboardCheckCode,
} from "../types";
import styles from "./AdminDashboard.module.css";

const issueText: Record<DashboardCheckCode, string> = {
  TERMINAL_DATE_VALIDITY:
    "Algunos pedidos revisados tienen fechas de finalización no válidas; esos eventos no se contabilizan como finalizaciones verificables.",
  HEADER_AMOUNT_VALIDITY: "Hay importes de pedidos que no se pueden calcular.",
  ITEM_INTEGRITY:
    "Faltan detalles fiables de algunos productos; sus indicadores pueden no estar disponibles.",
  HEADER_ITEM_RECONCILIATION:
    "Algunos importes de pedidos difieren de sus productos. Se conservan los valores históricos.",
  HISTORICAL_NAME:
    "Algunos productos no tienen un nombre histórico disponible.",
  UNDATED_TERMINALS:
    "Hay pedidos históricos sin una fecha de finalización válida.",
};
const warningIssues: [string, DashboardCheckCode][] = [
  ["INVALID_TERMINAL_DATES_", "TERMINAL_DATE_VALIDITY"],
  ["INVALID_HEADER_AMOUNT_", "HEADER_AMOUNT_VALIDITY"],
  ["INCOMPLETE_ITEMS_", "ITEM_INTEGRITY"],
  ["HEADER_ITEM_MISMATCH_", "HEADER_ITEM_RECONCILIATION"],
  ["MISSING_HISTORICAL_NAME_", "HISTORICAL_NAME"],
];
export function DashboardCoverage({ coverage }: { coverage: Coverage }) {
  const issues = new Set<string>();
  const notes = new Set<string>();
  for (const check of coverage.checks) {
    if (check.status === "WARN") issues.add(issueText[check.code]);
    if (check.status === "NOT_CHECKED")
      notes.add(
        check.code === "UNDATED_TERMINALS"
          ? "No se ha comprobado todo el histórico de pedidos."
          : "Hay comprobaciones pendientes sobre los pedidos del período.",
      );
  }
  if (coverage.provenance.status === "UNKNOWN")
    notes.add(
      "No se puede confirmar qué pedidos corresponden a operaciones reales.",
    );
  for (const warning of coverage.warnings) {
    const match = warningIssues.find(([prefix]) =>
      warning.code.startsWith(prefix),
    );
    if (match) issues.add(issueText[match[1]]);
    else if (warning.code === "UNDATED_TERMINALS_NOT_ASSESSED")
      notes.add("No se ha comprobado todo el histórico de pedidos.");
    else if (warning.code === "UNVERIFIED_ORDER_PROVENANCE")
      notes.add(
        "No se puede confirmar qué pedidos corresponden a operaciones reales.",
      );
    else if (warning.code === "NO_VERIFIABLE_EVENTS")
      notes.add(
        "No hay eventos verificables; esto no confirma ausencia total de actividad.",
      );
    else
      issues.add("Existe otra limitación en los datos que requiere atención.");
  }
  if (!issues.size && !notes.size)
    notes.add("No se ha verificado toda la información de este período.");
  const invalidDates = issues.has(issueText.TERMINAL_DATE_VALIDITY);
  return (
    <aside
      className={styles.coverage}
      id="dashboard-coverage"
      aria-labelledby="dashboard-coverage-title"
    >
      <h2 id="dashboard-coverage-title">Información sobre los datos</h2>
      <p>
        {invalidDates
          ? "Algunas estadísticas podrían no incluir todos los pedidos."
          : issues.size
            ? "Hay datos que afectan la fiabilidad de algunas estadísticas."
            : "Hay comprobaciones pendientes sobre los pedidos."}
      </p>
      <details open={issues.size > 0}>
        <summary>¿Por qué?</summary>
        <ul>
          {[...issues, ...notes].map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
