"use client";
import { CircleAlert } from "lucide-react";
import { useAvailability } from "../useAvailability";
import {
  OPEN_WITHOUT_PRODUCTS_MESSAGE,
  formatBusinessDate,
  openWithoutAvailableProducts,
} from "../presentation";
import { AvailabilitySwitch } from "./AvailabilitySwitch";
import { CategoryCarousel } from "./CategoryCarousel";
import {
  PanelHeader,
  SkeletonBlock,
  panelStyles,
} from "@/features/worker-ui/components/PanelHeader";
import styles from "./Availability.module.css";
import { Notice } from "@/components/ui/Notice";
import { ConnectionNotice } from "@/features/shared/components/ConnectionNotice";
import { Icon, ICON_MIN_20 } from "@/components/ui/Icon";
import { DailyMenuEditor } from "@/features/daily-menu/components/DailyMenuEditor";

/**
 * Disponibilidad as ONE glass panel, like Llamadas (F1, F3): the shared header with the nav's
 * switch icon (the module name appears once), the cafeteria as a row, and each category as a
 * section of the same panel, all separated by thin dividers.
 */
export function AvailabilityPanel() {
  const state = useAvailability();
  const blocked = state.refreshing || state.error !== null;
  return (
    <div className={panelStyles.page}>
      <section
        className={`${panelStyles.panel} ${styles.panel}`}
        aria-labelledby="availability-title"
        aria-busy={state.loading || state.refreshing}
      >
        <PanelHeader
          icon={<Icon name="disponibilidad" size={26} />}
          title="Disponibilidad"
          titleId="availability-title"
        />
        {/* D1: the cafeteria row and two category sections, with the cards' own size. */}
        {state.loading && (
          <div role="status" aria-label="Cargando disponibilidad">
            <div className={`${panelStyles.section} ${styles.cafeteriaState}`}>
              <span className={styles.cafeteriaDetails}>
                <SkeletonBlock height={20} width={210} />
                <SkeletonBlock height={14} width={260} />
              </span>
              <SkeletonBlock height={44} width={150} />
            </div>
            {[0, 1].map((section) => (
              <div
                key={section}
                className={`${panelStyles.section} ${styles.category}`}
              >
                <SkeletonBlock height={18} width={120} />
                <div className={styles.rail}>
                  {[0, 1, 2, 3].map((card) => (
                    <SkeletonBlock
                      key={card}
                      height={196}
                      className={styles.cardGhost}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {state.notice && (
          <div className={panelStyles.section}>
            <Notice tone="info">{state.notice}</Notice>
          </div>
        )}
        {state.error && (
          <div className={panelStyles.section}>
            <ConnectionNotice
              surface="glass"
              tone={state.data ? "offline" : "error"}
              retrying={state.refreshing}
              onRetry={() => {
                void state.refresh();
              }}
            >
              {state.error}
            </ConnectionNotice>
          </div>
        )}
        {state.data && (
          <>
            <section
              className={`${panelStyles.section} ${styles.cafeteriaState}`}
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
                  <span className={styles.administrativeState}>
                    {" · "}Estado administrativo:{" "}
                    <strong>
                      {state.data.cafeteria.active ? "Activa" : "Inactiva"}
                    </strong>
                  </span>
                </p>
                {!state.data.cafeteria.active && (
                  <p id="availability-inactive" className={styles.warning}>
                    <CircleAlert
                      size={20}
                      style={ICON_MIN_20}
                      aria-hidden="true"
                    />
                    <span>
                      La cafetería está administrativamente inactiva. Puedes
                      cerrar y deshabilitar productos; no abrir ni habilitar.
                    </span>
                  </p>
                )}
              </div>
              <div className={styles.cafeteriaControl}>
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
            {openWithoutAvailableProducts(state.data) && (
              <div className={panelStyles.section}>
                <p
                  id="availability-open-without-products"
                  className={styles.openWarning}
                  role="status"
                >
                  <CircleAlert size={20} aria-hidden="true" />
                  <span>{OPEN_WITHOUT_PRODUCTS_MESSAGE}</span>
                </p>
              </div>
            )}
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
        {/* PR 7: the daily menu below the catalogue categories, in the same panel. */}
        {!state.loading && <DailyMenuEditor />}
      </section>
    </div>
  );
}
