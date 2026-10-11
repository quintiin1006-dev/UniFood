import Image from "next/image";
import Link from "next/link";
import { UserRound } from "lucide-react";
import ClientBottomNav from "./ClientBottomNav";
import ClientHoursPreview from "./ClientHoursPreview";
import styles from "./ClientShell.module.css";

export default function ClientShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#client-content">
        Saltar al contenido
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link
            href="/cuenta"
            className={styles.brand}
            aria-label="UniFood — inicio"
          >
            <span className={styles.logo}>
              <Image
                src="/unifood-logo.png"
                alt=""
                width={64}
                height={64}
                priority
              />
            </span>
            <span>
              Uni<span className={styles.brandAccent}>Food</span>
            </span>
          </Link>
          <Link
            href="/cuenta/perfil"
            className={styles.profileLink}
            aria-label="Mi perfil"
          >
            <UserRound size={21} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <main id="client-content" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          <ClientHoursPreview />
          {children}
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
