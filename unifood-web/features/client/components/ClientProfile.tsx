import Link from "next/link";
import {
  ChevronRight,
  GraduationCap,
  IdCard,
  LockKeyhole,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";
import LogoutButton from "@/features/auth/components/LogoutButton";
import type { ClientDetails } from "../types";
import styles from "./ClientProfile.module.css";

export default function ClientProfile({
  fullName,
  email,
  details,
}: {
  fullName: string | null;
  email: string;
  details: ClientDetails;
}) {
  return (
    <section className={styles.profile} aria-labelledby="client-profile-title">
      <h1 id="client-profile-title">Mi perfil</h1>
      <div className={styles.identity}>
        <span className={styles.avatar}>
          <UserRound size={44} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <div>
          <h2>{fullName?.trim() || "Estudiante"}</h2>
          <p>{email}</p>
          {details.institution && <p>{details.institution}</p>}
        </div>
      </div>
      {details.unavailable && (
        <p className={styles.notice} role="status">
          No pudimos cargar todos los datos de tu perfil. Puedes volver a
          intentarlo recargando esta página.
        </p>
      )}
      <dl className={styles.details}>
        <div>
          <IdCard size={23} aria-hidden="true" />
          <dt>Documento</dt>
          <dd>{details.document || "No disponible"}</dd>
        </div>
        <div>
          <Mail size={23} aria-hidden="true" />
          <dt>Correo institucional</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <GraduationCap size={25} aria-hidden="true" />
          <dt>Universidad</dt>
          <dd>{details.institution || "No disponible"}</dd>
        </div>
        <div>
          <Phone size={23} aria-hidden="true" />
          <dt>Teléfono</dt>
          <dd>
            {details.phone ||
              (details.unavailable ? "No disponible" : "Sin registrar")}
          </dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <Link className={styles.action} href="/cuenta/perfil/contrasena">
          <LockKeyhole size={23} aria-hidden="true" />
          <span>Cambiar contraseña</span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
        <LogoutButton entrypoint="client" className={styles.logout} />
      </div>
    </section>
  );
}
