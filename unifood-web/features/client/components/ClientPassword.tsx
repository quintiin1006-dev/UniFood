import Link from "next/link";
import { ArrowLeft, LockKeyhole, Mail } from "lucide-react";
import RecoveryCodeLink from "@/features/auth/components/RecoveryCodeLink";
import { PROFILE_RESET_WITH_CODE } from "../../shared/messages";
import styles from "./ClientProfile.module.css";

/** The code goes to the account address at once; the student does not type it again. */
export default function ClientPassword({ email }: { email: string }) {
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
        <RecoveryCodeLink email={email} className={styles.primaryButton}>
          <Mail size={20} aria-hidden="true" />
          {PROFILE_RESET_WITH_CODE}
        </RecoveryCodeLink>
        <p className={styles.passwordNote}>
          Al actualizarla, volverás a iniciar sesión con tu nueva contraseña.
        </p>
      </div>
    </section>
  );
}
