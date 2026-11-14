"use client";

import { Building2, CircleAlert } from "lucide-react";
import LogoutButton from "@/features/auth/components/LogoutButton";
import adminStyles from "@/features/admin/components/Admin.module.css";
import {
  adminLabel,
  billingLabel,
  cafeteriaRows,
  summary,
  summaryText,
  visibilityLabel,
} from "../presentation";
import { findCafeteria } from "../state";
import { useSuperAdmin } from "../useSuperAdmin";
import { CafeteriaSettings } from "./CafeteriaSettings";
import styles from "./SuperAdmin.module.css";

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? adminStyles.active : adminStyles.inactiveBadge}>
      {label}
    </span>
  );
}

export function SuperAdminPanel() {
  const {
    data,
    loading,
    error,
    retry,
    selected,
    saving,
    controlError,
    notice,
    audit,
    select,
    setVisibility,
    setBilling,
    refuse,
    reloadAudit,
  } = useSuperAdmin();
  const rows = data ? cafeteriaRows(data) : [];
  const totals = data ? summary(data) : null;
  const current = findCafeteria(data, selected);
  return (
    <div className={adminStyles.shell}>
      <a className={adminStyles.skipLink} href="#super-admin-content">
        Ir al contenido
      </a>
      <div className={adminStyles.workspace}>
        <header className={adminStyles.header}>
          <div className={adminStyles.context}>
            <span className={adminStyles.contextIcon} aria-hidden="true">
              <Building2 size={23} strokeWidth={1.7} />
            </span>
            <div>
              <strong>Administración global</strong>
              <span className={adminStyles.contextLocation}>UniFood</span>
            </div>
          </div>
          <div className={adminStyles.headerActions} title="Cerrar sesión">
            <LogoutButton entrypoint="panel" className={adminStyles.logout} />
          </div>
        </header>
        <main
          id="super-admin-content"
          tabIndex={-1}
          className={adminStyles.main}
        >
          <div className={adminStyles.content}>
            <section className={adminStyles.section}>
              <p className={adminStyles.eyebrow}>ADMINISTRACIÓN GLOBAL</p>
              <h1>Cafeterías</h1>
              {totals && (
                <p className={adminStyles.intro}>{summaryText(totals)}</p>
              )}
            </section>
            {loading && !data && (
              <div className={adminStyles.feedback} role="status">
                Cargando cafeterías…
              </div>
            )}
            {error && (
              <div className={adminStyles.feedback} role="alert">
                <CircleAlert size={23} aria-hidden="true" />
                <p>{error.message}</p>
                {error.status === 401 ? (
                  <a href="/panel/login">Iniciar sesión</a>
                ) : (
                  error.status !== 403 && (
                    <button
                      type="button"
                      onClick={() => void retry()}
                      disabled={loading}
                    >
                      Reintentar
                    </button>
                  )
                )}
              </div>
            )}
            {data && (
              <div className={styles.card}>
                {rows.length === 0 ? (
                  <p className={styles.empty}>
                    Aún no hay cafeterías registradas.
                  </p>
                ) : (
                  <table className={styles.table}>
                    <caption>
                      Elige «Gestionar» para cambiar la visibilidad o el cobro
                      de una cafetería.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Cafetería</th>
                        <th scope="col">Sede</th>
                        <th scope="col">Institución</th>
                        <th scope="col">Visibilidad</th>
                        <th scope="col">Cobro</th>
                        <th scope="col">Administrador</th>
                        <th scope="col">
                          <span className={styles.visuallyHidden}>
                            Acciones
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className={
                            row.id === selected ? styles.selected : undefined
                          }
                        >
                          <th scope="row">{row.name}</th>
                          <td>
                            {row.site}
                            <small>
                              {row.city}
                              {!row.siteActive && " · Sede inactiva"}
                            </small>
                          </td>
                          <td>
                            {row.institution}
                            {!row.institutionActive && (
                              <small>Institución inactiva</small>
                            )}
                          </td>
                          <td>
                            <Badge
                              on={row.visible}
                              label={visibilityLabel(row.visible)}
                            />
                          </td>
                          <td>{billingLabel(row.billing)}</td>
                          <td>
                            <Badge
                              on={row.hasActiveAdmin}
                              label={adminLabel(row.hasActiveAdmin)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.secondary}
                              aria-expanded={row.id === selected}
                              aria-controls="cafeteria-settings"
                              aria-label={`Gestionar ${row.name}`}
                              disabled={saving !== null}
                              onClick={() =>
                                select(row.id === selected ? null : row.id)
                              }
                            >
                              Gestionar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {current && (
              <CafeteriaSettings
                cafeteria={current}
                saving={saving}
                controlError={controlError}
                notice={notice}
                audit={audit?.cafeteriaId === current.id ? audit : null}
                onClose={() => select(null)}
                onVisibility={(visible) => setVisibility(current.id, visible)}
                onBilling={(billing) => setBilling(current.id, billing)}
                onRefuse={refuse}
                onReloadAudit={() => void reloadAudit(current.id)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
