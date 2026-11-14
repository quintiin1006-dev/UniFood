"use client";
import { RefreshCw } from "lucide-react";
import { useAdminDashboard } from "../useAdminDashboard";
import { updatedAtLabel } from "../presentation";
import { DashboardPeriodLabel } from "./DashboardPeriodLabel";
import { DashboardPeriodFilter } from "./DashboardPeriodFilter";
import { DashboardSummary } from "./DashboardSummary";
import { OrdersTrend } from "./OrdersTrend";
import { NotCollectedProducts } from "./NotCollectedProducts";
import { DeliveredProductsRanking } from "./DeliveredProductsRanking";
import { DashboardCoverage } from "./DashboardCoverage";
import { DashboardLoading } from "./DashboardLoading";
import shell from "@/features/admin/components/Admin.module.css";
import styles from "./AdminDashboard.module.css";
import { Notice } from "@/components/ui/Notice";
import { Button, buttonClass } from "@/components/ui/Button";

export function AdminDashboard() {
  const {
    filters,
    data,
    error,
    refreshError,
    loading,
    referenceAsOf,
    updatedAt,
    load,
    refresh,
  } = useAdminDashboard();
  const denied = !!error && [401, 403].includes(error.status);
  const updated = data ? updatedAtLabel(updatedAt) : null;
  return (
    <section
      className={`${shell.section} ${styles.dashboard}`}
      aria-labelledby="admin-dashboard-title"
    >
      <div className={styles.heading}>
        <div>
          <h1 id="admin-dashboard-title">Dashboard</h1>
          <p className={styles.intro}>Resumen de pedidos y productos</p>
        </div>
        <div className={styles.refreshGroup}>
          {updated && (
            <span className={styles.updatedAt} aria-live="polite">
              {updated}
            </span>
          )}
          <button
            type="button"
            className={styles.refresh}
            disabled={loading || denied}
            aria-busy={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Actualizar
          </button>
        </div>
      </div>
      {refreshError && (
        <Notice tone="info" className={styles.message}>
          {refreshError}
        </Notice>
      )}
      <div className={styles.filterBar}>
        <DashboardPeriodFilter
          filters={filters}
          period={data?.period}
          asOf={referenceAsOf}
          disabled={denied}
          onApply={(next) => void load(next)}
        />
        {data && <DashboardPeriodLabel period={data.period} />}
      </div>
      {loading && !data && <DashboardLoading />}
      {error && (
        <Notice
          tone="error"
          title="No pudimos mostrar el dashboard"
          className={styles.message}
          action={
            error.status === 401 ? (
              <a className={buttonClass("secondary")} href="/panel/login">
                Iniciar sesión
              </a>
            ) : (
              error.status !== 403 && (
                <Button variant="secondary" onClick={() => void load()}>
                  Reintentar
                </Button>
              )
            )
          }
        >
          {error.message}
        </Notice>
      )}
      {data && (
        <div className={styles.results}>
          <DashboardSummary summary={data.summary} />
          <OrdersTrend trend={data.trend} />
          <NotCollectedProducts
            ranking={data.notCollectedProducts}
            summary={data.summary}
          />
          <DeliveredProductsRanking ranking={data.topDeliveredProducts} />
          <DashboardCoverage coverage={data.coverage} />
        </div>
      )}
    </section>
  );
}
