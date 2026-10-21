"use client";

import { UserRound } from "lucide-react";
import { useAdminProfile } from "../context";
import styles from "@/features/admin/components/Admin.module.css";

export function AdminProfilePanel() {
  const { data } = useAdminProfile();
  if (!data) return null;
  return (
    <section className={styles.section} aria-labelledby="admin-profile-title">
      <p className={styles.eyebrow}>TU CUENTA</p>
      <h1 id="admin-profile-title">Mi perfil</h1>
      <p className={styles.intro}>Tu cuenta y la cafetería que administras.</p>
      <article className={styles.profileCard} aria-label="Datos de tu perfil">
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            <UserRound size={29} strokeWidth={1.5} />
          </span>
          <dl>
            <div>
              <dt>Correo</dt>
              <dd>{data.email}</dd>
            </div>
            <div>
              <dt>Rol</dt>
              <dd>Administrador</dd>
            </div>
          </dl>
        </div>
        <div className={styles.business}>
          <h2>Tu cafetería</h2>
          <dl className={styles.details}>
            <div>
              <dt>Cafetería</dt>
              <dd>{data.cafeteria.name}</dd>
            </div>
            <div>
              <dt>Estado de cafetería</dt>
              <dd>
                <span
                  className={
                    data.cafeteria.active ? styles.active : styles.inactiveBadge
                  }
                >
                  {data.cafeteria.active ? "Activa" : "Inactiva"}
                </span>
              </dd>
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
        </div>
        <p className={styles.readOnly}>
          Información de consulta · Solo lectura
        </p>
      </article>
    </section>
  );
}
