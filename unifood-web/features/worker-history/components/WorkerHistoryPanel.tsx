"use client";
import { CircleAlert, History, RefreshCw } from "lucide-react";
import { useWorkerHistory } from "../useWorkerHistory";
import { formatBusinessDate } from "../presentation";
import { HistoryOrderCard } from "./HistoryOrderCard";
import styles from "./WorkerHistory.module.css";

export function WorkerHistoryPanel() {
  const state = useWorkerHistory();
  const denied = state.error?.status === 401 || state.error?.status === 403;
  return (
    <section className={styles.panel} aria-labelledby="worker-history-title">
      <div className={styles.heading}>
        <div>
          <h2 id="worker-history-title">Historial</h2>
          {state.data && (
            <p className={styles.date}>
              Hoy ·{" "}
              <time dateTime={state.data.businessDate}>
                {formatBusinessDate(state.data.businessDate)}
              </time>
            </p>
          )}
        </div>
        {state.data && !state.error && (
          <button
            className={styles.refresh}
            type="button"
            disabled={state.refreshing}
            onClick={() => void state.refresh()}
            aria-label="Actualizar historial"
          >
            <RefreshCw size={17} aria-hidden="true" />
            <span>{state.refreshing ? "Actualizando…" : "Actualizar"}</span>
          </button>
        )}
      </div>
      {state.loading && (
        <div className={styles.loading} role="status">
          <p>Cargando historial…</p>
          <div className={styles.skeletons} aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
        </div>
      )}
      {state.error && (
        <div className={styles.error} role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <div>
            <p>{state.error.message}</p>
            {state.data && (
              <p className={styles.stale}>
                Datos de la última consulta. Actualiza para confirmar el
                historial de hoy.
              </p>
            )}
          </div>
          {state.error.status === 401 ? (
            <a href="/panel/login">Iniciar sesión</a>
          ) : (
            !denied && (
              <button
                type="button"
                disabled={state.loading || state.refreshing}
                onClick={() => void state.refresh()}
              >
                {state.loading || state.refreshing
                  ? "Reintentando…"
                  : "Reintentar"}
              </button>
            )
          )}
        </div>
      )}
      {state.data && (
        <>
          <div className={styles.summary}>
            <span>
              {state.data.orders.length}{" "}
              {state.data.orders.length === 1
                ? "pedido finalizado"
                : "pedidos finalizados"}
            </span>
            <span>Hora de Bogotá</span>
          </div>
          {state.data.orders.length === 0 ? (
            <div className={styles.empty} role="status">
              <span className={styles.emptyIcon}>
                <History size={26} aria-hidden="true" />
              </span>
              <h3>Aún no hay pedidos finalizados hoy.</h3>
              <p>
                Los pedidos entregados, no recogidos y cancelados aparecerán
                aquí.
              </p>
            </div>
          ) : (
            <div
              className={styles.cards}
              aria-label="Pedidos finalizados"
              aria-busy={state.refreshing}
            >
              {state.data.orders.map((order) => (
                <HistoryOrderCard key={order.id} order={order} />
              ))}
            </div>
          )}
        </>
      )}
      <span className={styles.srOnly} role="status">
        {state.refreshing ? "Actualizando historial…" : ""}
      </span>
    </section>
  );
}
