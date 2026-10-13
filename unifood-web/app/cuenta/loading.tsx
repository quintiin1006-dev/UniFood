import Image from "next/image";
import styles from "@/features/client/components/ClientHome.module.css";

export default function ClientLoading() {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <Image
        className={styles.welcomeLogo}
        src="/unifood-logo.png"
        alt="UniFood"
        width={104}
        height={104}
      />
      <h1>Bienvenido</h1>
      <p>Estamos preparando tu espacio…</p>
      <span className={styles.progress} aria-hidden="true" />
    </div>
  );
}
