import { CalendarDays } from "lucide-react";
import type { DashboardPeriod } from "../types";
import { compactPeriodLabel, periodLabel, formatAsOf } from "../presentation";
import { DashboardInfo } from "./DashboardInfo";
import styles from "./AdminDashboard.module.css";

export function DashboardPeriodLabel({ period }: { period: DashboardPeriod }) {
  return (
    <div
      className={styles.periodMeta}
      role="group"
      aria-label="Período consultado"
    >
      <CalendarDays size={16} aria-hidden="true" />
      <span aria-label={periodLabel(period)}>{compactPeriodLabel(period)}</span>
      {period.partial && (
        <span
          className={styles.partialDot}
          role="img"
          aria-label="Período en curso"
        />
      )}
      <DashboardInfo label="Detalles del período">
        <p>{period.partial ? "Período en curso." : "Período completo."}</p>
        <p>
          Consultado: {formatAsOf(period.asOf)}. Fechas de Colombia. Importes en
          COP.
        </p>
      </DashboardInfo>
    </div>
  );
}
