"use client";
import { useState } from "react";
import { bogotaDate } from "../filters";
import { customPeriodError } from "../presentation";
import type { DashboardFilters, DashboardPeriod } from "../types";
import styles from "./AdminDashboard.module.css";

export function DashboardPeriodFilter({
  filters,
  period,
  asOf,
  disabled,
  onApply,
}: {
  filters: DashboardFilters;
  period?: DashboardPeriod;
  asOf: string | null;
  disabled: boolean;
  onApply: (filters: DashboardFilters) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <fieldset className={styles.filters} disabled={disabled}>
      <legend>Período</legend>
      <div className={styles.periodButtons}>
        {(
          [
            ["TODAY", "Hoy"],
            ["LAST_7_DAYS", "Últimos 7 días"],
            ["LAST_30_DAYS", "Últimos 30 días"],
          ] as const
        ).map(([range, label]) => (
          <button
            type="button"
            key={range}
            aria-pressed={!custom && filters.range === range}
            onClick={() => {
              setCustom(false);
              setError(null);
              onApply({ range, rankingLimit: 10 });
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom || filters.range === "CUSTOM"}
          onClick={() => {
            setCustom(true);
            setFrom(filters.from ?? period?.from ?? "");
            setTo(filters.to ?? period?.to ?? "");
            setError(null);
          }}
        >
          Personalizado
        </button>
      </div>
      {custom && (
        <form
          className={styles.customDates}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const issue = customPeriodError(from, to, asOf);
            setError(issue);
            if (!issue)
              onApply({ range: "CUSTOM", from, to, rankingLimit: 10 });
          }}
        >
          <label>
            Fecha inicial
            <input
              type="date"
              value={from}
              max={asOf ? bogotaDate(new Date(asOf)) : undefined}
              required
              aria-describedby="dashboard-custom-help dashboard-date-error"
              aria-invalid={!!error}
              onChange={(e) => {
                setFrom(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label>
            Fecha final
            <input
              type="date"
              value={to}
              max={asOf ? bogotaDate(new Date(asOf)) : undefined}
              required
              aria-describedby="dashboard-custom-help dashboard-date-error"
              aria-invalid={!!error}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
            />
          </label>
          <button type="submit" className={styles.primary}>
            Aplicar fechas
          </button>
          <p id="dashboard-custom-help" className={styles.hint}>
            Fechas inclusivas en Colombia. Máximo 366 días. Aplica las fechas
            para actualizar todos los resultados.
          </p>
          <p
            id="dashboard-date-error"
            role={error ? "alert" : undefined}
            className={styles.dateError}
          >
            {error}
          </p>
        </form>
      )}
    </fieldset>
  );
}
