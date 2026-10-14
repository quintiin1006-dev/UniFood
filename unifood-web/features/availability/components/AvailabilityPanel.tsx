"use client";
import { RefreshCw, CircleAlert } from "lucide-react";
import { useAvailability } from "../useAvailability";
import { formatBusinessDate } from "../presentation";
import { AvailabilitySwitch } from "./AvailabilitySwitch";
import { CategoryCarousel } from "./CategoryCarousel";
import styles from "./Availability.module.css";

export function AvailabilityPanel() {
  const state = useAvailability();
  const blocked = state.refreshing || state.error !== null;
  return (
    <section
      className={styles.panel}
      aria-labelledby="availability-title"
      aria-busy={state.loading || state.refreshing}
    >
      <div className={styles.titleRow}>
        <div>
          <h2 id="availability-title">Disponibilidad</h2>
        </div>
        {state.data && (
          <button
            type="button"
            className={styles.refresh}
            aria-label="Actualizar disponibilidad"
            disabled={
              state.refreshing ||
              state.cafeteriaBusy ||
              state.busyItems.length > 0
            }
            onClick={() => {
              void state.refresh();
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
            <span>{state.refreshing ? "Actualizando…" : "Actualizar"}</span>
          </button>
        )}
      </div>
      {state.loading && (
        <div className={styles.loading} role="status">
          <p>Cargando disponibilidad…</p>
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}
      {state.notice && (
        <p className={styles.notice} role="status">
          {state.notice}
        </p>
      )}
      {state.error && (
        <div className={styles.error} role="alert">
          <p>{state.error}</p>
          <button
            type="button"
            onClick={() => {
              void state.refresh();
            }}
          >
            Reintentar
          </button>
        </div>
      )}
      {state.data && (
        <>
          <section
            className={styles.cafeteriaState}
            aria-labelledby="availability-cafeteria-name"
            aria-busy={state.cafeteriaBusy}
          >
            <div className={styles.cafeteriaDetails}>
              <h3
                id="availability-cafeteria-name"
                className={styles.cafeteriaName}
              >
                {state.data.cafeteria.name}
              </h3>
              <p className={styles.date}>
                Hoy ·{" "}
                <time dateTime={state.data.businessDate}>
                  {formatBusinessDate(state.data.businessDate)}
                </time>
              </p>
              <p className={styles.administrativeState}>
                Estado administrativo
                <span
                  className={`${styles.badge} ${!state.data.cafeteria.active ? styles.inactiveBadge : ""}`}
                >
                  {state.data.cafeteria.active ? "Activa" : "Inactiva"}
                </span>
              </p>
              {!state.data.cafeteria.active && (
                <p id="availability-inactive" className={styles.warning}>
                  <CircleAlert size={18} aria-hidden="true" />
                  <span>
                    La cafetería está administrativamente inactiva. Puedes
                    cerrar y deshabilitar productos; no abrir ni habilitar.
                  </span>
                </p>
              )}
            </div>
            <div className={styles.cafeteriaControl}>
              <p className={styles.operationLabel}>Estado de la cafetería</p>
              <AvailabilitySwitch
                checked={state.data.cafeteria.open}
                disabled={
                  state.cafeteriaBusy ||
                  blocked ||
                  (!state.data.cafeteria.active && !state.data.cafeteria.open)
                }
                label="Apertura de cafetería"
                text={state.data.cafeteria.open ? "ABIERTA" : "CERRADA"}
                descriptionId={
                  !state.data.cafeteria.active
                    ? "availability-inactive"
                    : "availability-cafeteria-feedback"
                }
                onChange={(value) => {
                  void state.setCafeteria(value);
                }}
              />
              <p className={styles.operationHelp}>
                Controla la apertura para hoy.
              </p>
              <p
                id="availability-cafeteria-feedback"
                className={styles.feedback}
                role={state.cafeteriaError ? "alert" : "status"}
              >
                {state.cafeteriaBusy
                  ? "Guardando…"
                  : (state.cafeteriaError ?? "")}
              </p>
            </div>
          </section>
          {state.data.categories.map((group) => (
            <CategoryCarousel
              key={group.category}
              {...group}
              cafeteriaActive={state.data!.cafeteria.active}
              busyItems={state.busyItems}
              blocked={blocked}
              errors={state.itemErrors}
              onChange={(id, value) => {
                void state.setItem(id, value);
              }}
            />
          ))}
        </>
      )}
    </section>
  );
}
