import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import SendRecoveryCode from "@/features/auth/components/SendRecoveryCode";
import { RECOVERY_TITLE } from "../../shared/messages";
import styles from "./ClientProfile.module.css";

/**
 * Step 1 of changing the password: the account address is known, one button sends the code.
 * Step 2 (code, new password and confirmation) is the recovery screen.
 */
export default function ClientPassword({ email }: { email: string }) {
  return (
    <section className={styles.profile} aria-labelledby="password-title">
      <Link className={styles.back} href="/cuenta/perfil">
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al perfil
      </Link>
      <div>
        <h1 id="password-title">{RECOVERY_TITLE}</h1>
      </div>
      <div className={styles.passwordPanel}>
        <span className={styles.lockIcon}>
          <LockKeyhole size={30} aria-hidden="true" />
        </span>
        <SendRecoveryCode email={email} className={styles.primaryButton} />
      </div>
    </section>
  );
}
