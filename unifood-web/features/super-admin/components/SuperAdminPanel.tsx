"use client";

import { Building2, CircleAlert } from "lucide-react";
import LogoutButton from "@/features/auth/components/LogoutButton";
import adminStyles from "@/features/admin/components/Admin.module.css";
import {
  adminLabel,
  cafeteriaRows,
  subscriptionLabel,
  summary,
} from "../presentation";
import { useSuperAdmin } from "../useSuperAdmin";
import styles from "./SuperAdmin.module.css";

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? adminStyles.active : adminStyles.inactiveBadge}>
      {label}
    </span>
  );
}

export function SuperAdminPanel() {
  const { data, loading, error, retry } = useSuperAdmin();
  const rows = data ? cafeteriaRows(data) : [];
  const totals = data ? summary(data) : null;
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
              <p className={adminStyles.eyebrow}>SOLO LECTURA</p>
              <h1>Cafeterías</h1>
              {totals && (
                <p className={adminStyles.intro}>
                  {totals.cafeterias} cafeterías en {totals.sites} sedes de{" "}
                  {totals.institutions} instituciones · {totals.subscribed} con
                  suscripción activa.
                </p>
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
                      La suscripción solo se cambia por SQL controlado por
                      ahora.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Cafetería</th>
                        <th scope="col">Sede</th>
                        <th scope="col">Institución</th>
                        <th scope="col">Suscripción</th>
                        <th scope="col">ADMIN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
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
                              on={row.subscribed}
                              label={subscriptionLabel(row.subscribed)}
                            />
                          </td>
                          <td>
                            <Badge
                              on={row.hasActiveAdmin}
                              label={adminLabel(row.hasActiveAdmin)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
