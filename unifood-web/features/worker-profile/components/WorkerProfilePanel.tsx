"use client";
import { CircleAlert, Mail, UserRound } from "lucide-react";
import { useWorkerProfile } from "../useWorkerProfile";
import { inactiveCafeteriaMessage, workerRoleLabel } from "../presentation";
import styles from "./WorkerProfile.module.css";

export function WorkerProfilePanel() {
  const { data, loading, error, retry } = useWorkerProfile();
  return (
    <section className={styles.panel} aria-labelledby="worker-profile-title">
      <div className={styles.heading}>
        <h2 id="worker-profile-title">Mi perfil</h2>
        <p>Tu cuenta y contexto de trabajo.</p>
      </div>
      {loading && (
        <div className={styles.loading} role="status">
          <p>Cargando tu perfil…</p>
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <CircleAlert size={21} aria-hidden="true" />
          <p>{error.message}</p>
          {error.status === 401 ? (
            <a href="/panel/login">Iniciar sesión</a>
          ) : (
            error.status !== 403 && (
              <button type="button" onClick={() => void retry()}>
                Reintentar
              </button>
            )
          )}
        </div>
      )}
      {data && (
        <article className={styles.card} aria-label="Datos de tu perfil">
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              <UserRound size={29} strokeWidth={1.6} />
            </span>
            <dl className={styles.account}>
              <div>
                <dt>
                  <Mail size={15} aria-hidden="true" />
                  Correo
                </dt>
                <dd>{data.email}</dd>
              </div>
              <div>
                <dt>Rol</dt>
                <dd className={styles.role}>{workerRoleLabel}</dd>
              </div>
            </dl>
          </div>
          <div className={styles.work}>
            <h3>Información laboral</h3>
            <dl className={styles.details}>
              <div className={styles.cafeteria}>
                <dt>Cafetería</dt>
                <dd>{data.cafeteria.name}</dd>
              </div>
              <div>
                <dt>Sede</dt>
                <dd>{data.site.name}</dd>
              </div>
              <div>
                <dt>Institución</dt>
                <dd>{data.institution.name}</dd>
              </div>
            </dl>
            {!data.cafeteria.active && (
              <p className={styles.notice} role="status">
                <CircleAlert size={18} aria-hidden="true" />
                {inactiveCafeteriaMessage}
              </p>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
