import type {
  DashboardCoverage as Coverage,
  DashboardCheckCode,
} from "../types";
import styles from "./AdminDashboard.module.css";

const issueText: Record<DashboardCheckCode, string> = {
  TERMINAL_DATE_VALIDITY:
    "Algunos pedidos tienen una fecha de cierre no válida y no se cuentan como finalizados.",
  HEADER_AMOUNT_VALIDITY: "No se pudo calcular el valor de algunos pedidos.",
  ITEM_INTEGRITY:
    "A algunos pedidos les falta el detalle de productos; ciertos rankings pueden no mostrarse.",
  HEADER_ITEM_RECONCILIATION:
    "El total de algunos pedidos no coincide con sus productos; se muestra el valor registrado.",
  HISTORICAL_NAME: "Algunos productos no conservan su nombre original.",
  UNDATED_TERMINALS: "Hay pedidos antiguos sin fecha de cierre.",
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
          : "Aún quedan revisiones pendientes sobre los pedidos del período.",
      );
  }
  if (coverage.provenance.status === "UNKNOWN")
    notes.add("Las cifras pueden incluir pedidos de prueba.");
  for (const warning of coverage.warnings) {
    const match = warningIssues.find(([prefix]) =>
      warning.code.startsWith(prefix),
    );
    if (match) issues.add(issueText[match[1]]);
    else if (warning.code === "UNDATED_TERMINALS_NOT_ASSESSED")
      notes.add("No se ha comprobado todo el histórico de pedidos.");
    else if (warning.code === "UNVERIFIED_ORDER_PROVENANCE")
      notes.add("Las cifras pueden incluir pedidos de prueba.");
    else if (warning.code === "NO_VERIFIABLE_EVENTS")
      notes.add("No hay pedidos finalizados con fecha en este período.");
    else issues.add("Hay otra limitación en los datos.");
  }
  if (!issues.size && !notes.size)
    notes.add("Las cifras de este período son orientativas.");
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
          ? "Algunas cifras podrían no incluir todos los pedidos."
          : issues.size
            ? "Algunas cifras pueden estar incompletas."
            : "Las cifras son orientativas mientras terminamos de revisar los pedidos."}
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
