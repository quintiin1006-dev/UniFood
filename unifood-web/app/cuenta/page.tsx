import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import {
  destination,
  isAdmin,
  isSuperAdmin,
  isWorker,
} from "@/features/auth/validation";
import Brand, { Waves } from "@/features/auth/components/Brand";
import LogoutButton from "@/features/auth/components/LogoutButton";
import styles from "@/features/auth/components/AuthScreen.module.css";

export const metadata = { title: "Mi cuenta | UniFood" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { profile } = await requireAuth();
  if (isAdmin(profile) || isSuperAdmin(profile)) redirect(destination(profile));
  return (
    <main className={styles.screen}>
      <div className={styles.canvas}>
        <div className={styles.content}>
          <Brand />
          <div className={styles.account}>
            <BadgeCheck size={56} strokeWidth={1.5} />
            <h1 className={styles.heading}>
              ¡Hola
              {profile.fullName ? `, ${profile.fullName.split(" ")[0]}` : ""}!
            </h1>
            <p className={styles.description}>Tu cuenta está verificada.</p>
            <p className={styles.email}>{profile.email}</p>
            {isWorker(profile) ? (
              <Link href="/worker" className={styles.primary}>
                Ir al panel de trabajador
              </Link>
            ) : (
              <p className={styles.description}>
                Ya eres parte de UniFood. Pronto podrás consultar el menú y
                pedir desde aquí.
              </p>
            )}
            <LogoutButton className={styles.link} />
          </div>
        </div>
        <Waves />
      </div>
    </main>
  );
}
