"use client";
import { RefreshCw, ArrowDownRight, CircleAlert } from "lucide-react";
import { useAdminDashboard } from "../useAdminDashboard";
import { formatAsOf, periodLabel } from "../presentation";
import { DashboardPeriodFilter } from "./DashboardPeriodFilter";
import { DashboardSummary } from "./DashboardSummary";
import { OrdersTrend } from "./OrdersTrend";
import { NotCollectedProducts } from "./NotCollectedProducts";
import { DeliveredProductsRanking } from "./DeliveredProductsRanking";
import { DashboardCoverage } from "./DashboardCoverage";
import shell from "@/features/admin/components/Admin.module.css";
import styles from "./AdminDashboard.module.css";

export function AdminDashboard() {
  const { filters, data, error, loading, referenceAsOf, load } =
    useAdminDashboard();
  const denied = !!error && [401, 403].includes(error.status);
  return (
    <section
      className={`${shell.section} ${styles.dashboard}`}
      aria-labelledby="admin-dashboard-title"
    >
      <div className={styles.heading}>
        <div>
          <p className={shell.eyebrow}>TU CAFETERÍA EN CIFRAS</p>
          <h1 id="admin-dashboard-title">Dashboard</h1>
          <p className={styles.intro}>
            Pedidos, entregas y productos de tu cafetería.
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          disabled={loading || denied}
          onClick={() => void load()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Actualizar
        </button>
      </div>
      <DashboardPeriodFilter
        filters={filters}
        period={data?.period}
        asOf={referenceAsOf}
        disabled={denied}
        onApply={(next) => void load(next)}
      />
      {loading && (
        <div className={styles.loading} role="status">
          <span className={styles.loadingDot} aria-hidden="true" />
          Consultando el período seleccionado…
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <CircleAlert size={23} aria-hidden="true" />
          <div>
            <strong>No pudimos mostrar el dashboard</strong>
            <p>{error.message}</p>
            {error.status === 401 ? (
              <a href="/panel/login">Iniciar sesión</a>
            ) : (
              error.status !== 403 && (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void load()}
                >
                  Reintentar
                </button>
              )
            )}
          </div>
        </div>
      )}
      {data && (
        <div className={styles.results}>
          <div className={styles.effectivePeriod}>
            <p>
              <strong>Período aplicado:</strong> {periodLabel(data.period)}
              <br />
              <span>
                Actualizado: {formatAsOf(data.period.asOf)} · Hora de Colombia ·
                Valores en COP
              </span>
            </p>
            {data.period.partial && (
              <span className={styles.badge}>Período en curso</span>
            )}
            <a href="#not-collected-products">
              Ver no recogidos <ArrowDownRight size={15} aria-hidden="true" />
            </a>
          </div>
          {data.coverage.warnings.some(
            (w) => w.code === "NO_VERIFIABLE_EVENTS",
          ) && (
            <p className={styles.empty}>
              No hay eventos verificables en este período. La cobertura es
              limitada; esto no confirma ausencia total de actividad.
            </p>
          )}
          <DashboardSummary summary={data.summary} />
          <DashboardCoverage coverage={data.coverage} />
          <OrdersTrend trend={data.trend} />
          <NotCollectedProducts
            ranking={data.notCollectedProducts}
            summary={data.summary}
          />
          <DeliveredProductsRanking ranking={data.topDeliveredProducts} />
        </div>
      )}
    </section>
  );
}
