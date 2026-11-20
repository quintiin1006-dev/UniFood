"use client";
import { useRef } from "react";
import { History, Search, X } from "lucide-react";
import { useWorkerHistory } from "../useWorkerHistory";
import { formatDayDate } from "../presentation";
import { HistoryOrderRow } from "./HistoryOrderRow";
import type { HistoryRange, HistoryStatus } from "../types";
import {
  PanelHeader,
  SkeletonBlock,
  panelStyles,
} from "@/features/worker-ui/components/PanelHeader";
import styles from "./WorkerHistory.module.css";
import { ConnectionNotice } from "@/features/shared/components/ConnectionNotice";
import { buttonClass } from "@/components/ui/Button";
import { CONNECTION_STALE_HISTORY } from "@/features/shared/messages";
import { Icon, ICON_MIN_20 } from "@/components/ui/Icon";

/**
 * Historial as ONE glass panel, like Llamadas (F1, F2): the shared header with the nav's clock
 * icon and the day as subtitle, the filters in one row, then the rows, all separated by thin
 * dividers inside the same panel.
 */
export function WorkerHistoryPanel() {
  const state = useWorkerHistory();
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    state.setQuery("");
    searchInput.current?.focus();
  };
  const denied = state.error?.status === 401 || state.error?.status === 403;
  return (
    <div className={panelStyles.page}>
      <section
        className={`${panelStyles.panel} ${styles.panel}`}
        aria-labelledby="worker-history-title"
        aria-busy={state.loading || state.refreshing || state.loadingMore}
      >
        <PanelHeader
          icon={<Icon name="historial" size={26} />}
          title="Historial"
          titleId="worker-history-title"
          subtitle={
            state.data ? formatDayDate(state.data.businessDate) : undefined
          }
        />
        <div className={`${panelStyles.section} ${styles.filters}`}>
          <div
            className={styles.search}
            role="search"
            aria-label="Buscar en el historial del mes"
          >
            <label htmlFor="worker-history-search" className={styles.srOnly}>
              Buscar por pedido, cliente, estado o producto
            </label>
            <Search size={20} style={ICON_MIN_20} aria-hidden="true" />
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
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          <label className={styles.filter}>
            <span className={styles.srOnly}>Período</span>
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
          <label className={styles.filter}>
            <span className={styles.srOnly}>Estado</span>
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
        </div>
        {/* D1: ghost rows with the size of the real ones, so nothing jumps when they arrive. */}
        {state.loading && (
          <div
            className={styles.list}
            role="status"
            aria-label="Cargando historial"
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className={`${styles.row} ${styles.rowHead}`}>
                <span className={styles.rowIdentity}>
                  <SkeletonBlock height={18} width={row % 2 ? 150 : 190} />
                  <SkeletonBlock height={14} width={64} />
                </span>
                <SkeletonBlock height={32} width={104} />
              </div>
            ))}
          </div>
        )}
        {state.error && (
          <div className={panelStyles.section}>
            {/* C: with rows still on screen a calm notice; with nothing, a soft error. */}
            <ConnectionNotice
              surface="glass"
              tone={state.data ? "offline" : "error"}
              retrying={state.loading || state.refreshing}
              onRetry={denied ? undefined : () => void state.refresh()}
              action={
                state.error.status === 401 ? (
                  <a className={buttonClass("secondary")} href="/panel/login">
                    Iniciar sesión
                  </a>
                ) : undefined
              }
            >
              <p>{state.error.message}</p>
              {state.data && <p>{CONNECTION_STALE_HISTORY}</p>}
            </ConnectionNotice>
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
                className={styles.list}
                aria-label="Pedidos finalizados"
                aria-busy={state.refreshing}
              >
                {state.data.orders.map((order) => (
                  <HistoryOrderRow key={order.id} order={order} />
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
    </div>
  );
}
