"use client";

import Link from "next/link";
import styles from "@/features/client/components/ClientHome.module.css";

export default function ClientError({ retry }: { retry: () => void }) {
  return (
    <section className={styles.state} aria-labelledby="client-error-title">
      <h1 id="client-error-title">No pudimos cargar esta pantalla</h1>
      <p role="alert">Inténtalo de nuevo en un momento.</p>
      <button type="button" className={styles.button} onClick={retry}>
        Volver a intentar
      </button>
      <Link className={styles.textLink} href="/login">
        Volver al acceso
      </Link>
    </section>
  );
}
