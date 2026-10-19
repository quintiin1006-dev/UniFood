"use client";
import { useRef } from "react";
import { CircleAlert, History, RefreshCw, Search, X } from "lucide-react";
import { useWorkerHistory } from "../useWorkerHistory";
import { formatBusinessDate } from "../presentation";
import { HistoryOrderCard } from "./HistoryOrderCard";
import type { HistoryRange, HistoryStatus } from "../types";
import styles from "./WorkerHistory.module.css";

export function WorkerHistoryPanel() {
  const state = useWorkerHistory();
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    state.setQuery("");
    searchInput.current?.focus();
  };
  const denied = state.error?.status === 401 || state.error?.status === 403;
  return (
    <section
      className={styles.panel}
      aria-labelledby="worker-history-title"
      aria-busy={state.loading || state.refreshing || state.loadingMore}
    >
      <div className={styles.heading}>
        <div>
          <h2 id="worker-history-title">Historial</h2>
          {state.data && (
            <p className={styles.date}>
              Mes actual ·{" "}
              <time dateTime={state.data.monthStart}>
                {formatBusinessDate(state.data.monthStart)}
              </time>{" "}
              al{" "}
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
            disabled={state.refreshing || state.loadingMore}
            onClick={() => void state.refresh()}
            aria-label="Actualizar historial"
          >
            <RefreshCw size={17} aria-hidden="true" />
            <span>{state.refreshing ? "Actualizando…" : "Actualizar"}</span>
          </button>
        )}
      </div>
      <div
        className={styles.search}
        role="search"
        aria-label="Buscar en el historial del mes"
      >
        <label htmlFor="worker-history-search" className={styles.srOnly}>
          Buscar por pedido, cliente, estado o producto
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="worker-history-search"
          ref={searchInput}
          type="search"
          maxLength={120}
          placeholder="Buscar por pedido, cliente, estado o producto"
          autoComplete="off"
          value={state.query}
          onChange={(event) => state.setQuery(event.target.value)}
        />
        {state.query.length > 0 && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={clearSearch}
          >
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={styles.filters}>
        <label>
          Período
          <select
            aria-label="Período del historial"
            value={state.range}
            onChange={(event) =>
              state.setRange(event.target.value as HistoryRange)
            }
          >
            <option value="MONTH">Mes actual</option>
            <option value="WEEK">Esta semana</option>
            <option value="TODAY">Hoy</option>
          </select>
        </label>
        <label>
          Estado
          <select
            aria-label="Estado del historial"
            value={state.status}
            onChange={(event) =>
              state.setStatus(event.target.value as HistoryStatus | "")
            }
          >
            <option value="">Todos los estados</option>
            <option value="DELIVERED">Entregado</option>
            <option value="NOT_COLLECTED">No recogido</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </label>
        <span>Hora de Bogotá</span>
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
                historial.
              </p>
            )}
          </div>
          {state.error.status === 401 ? (
            <a href="/panel/login">Iniciar sesión</a>
          ) : (
            !denied && (
              <button
                type="button"
                disabled={
                  state.loading || state.refreshing || state.loadingMore
                }
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
      {state.data && !state.loading && (
        <>
          {!state.data.orders.length ? (
            <div className={styles.empty} role="status">
              <span className={styles.emptyIcon}>
                {state.data.hasHistory ? (
                  <Search size={26} aria-hidden="true" />
                ) : (
                  <History size={26} aria-hidden="true" />
                )}
              </span>
              <h3>
                {state.data.hasHistory
                  ? "No encontramos pedidos que coincidan con los filtros."
                  : "Aún no hay pedidos finalizados este mes."}
              </h3>
              {state.data.hasHistory ? (
                <button
                  className={styles.refresh}
                  type="button"
                  onClick={() => {
                    state.clearFilters();
                    searchInput.current?.focus();
                  }}
                >
                  Limpiar filtros
                </button>
              ) : (
                <p>
                  Los pedidos entregados, no recogidos y cancelados aparecerán
                  aquí.
                </p>
              )}
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
          {state.data.nextCursor && (
            <div className={styles.pagination}>
              <button
                className={styles.refresh}
                type="button"
                onClick={() => void state.loadMore()}
                disabled={state.loadingMore || state.refreshing}
              >
                {state.loadingMore ? "Cargando…" : "Cargar más"}
              </button>
            </div>
          )}
        </>
      )}
      <span className={styles.srOnly} role="status">
        {state.refreshing
          ? "Actualizando historial…"
          : state.loadingMore
            ? "Cargando más pedidos…"
            : ""}
      </span>
    </section>
  );
}
