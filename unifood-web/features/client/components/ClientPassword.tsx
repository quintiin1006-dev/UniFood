import Link from "next/link";
import { ArrowLeft, LockKeyhole, Mail } from "lucide-react";
import styles from "./ClientProfile.module.css";

export default function ClientPassword() {
  return (
    <section className={styles.profile} aria-labelledby="password-title">
      <Link className={styles.back} href="/cuenta/perfil">
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al perfil
      </Link>
      <div>
        <h1 id="password-title">Cambiar contraseña</h1>
        <p className={styles.subtitle}>Protege el acceso a tu cuenta.</p>
      </div>
      <div className={styles.passwordPanel}>
        <span className={styles.lockIcon}>
          <LockKeyhole size={30} aria-hidden="true" />
        </span>
        <h2>Verifica tu correo</h2>
        <p>
          Te enviaremos un código a tu correo institucional. Después de
          verificarlo, podrás establecer una nueva contraseña.
        </p>
        <Link
          className={styles.primaryButton}
          href="/recuperar-contrasena?entrypoint=client"
        >
          <Mail size={20} aria-hidden="true" />
          Continuar por correo
        </Link>
        <p className={styles.passwordNote}>
          Al actualizarla, volverás a iniciar sesión con tu nueva contraseña.
        </p>
      </div>
    </section>
  );
}
