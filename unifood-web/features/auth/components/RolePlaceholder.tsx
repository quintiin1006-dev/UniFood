import Brand, { Waves } from "./Brand";
import LogoutButton from "./LogoutButton";
import styles from "./AuthScreen.module.css";
import type { AuthEntrypoint } from "../validation";

export default function RolePlaceholder({
  title,
  entrypoint,
}: {
  title: string;
  entrypoint: AuthEntrypoint;
}) {
  return (
    <main className={styles.screen}>
      <div className={styles.canvas}>
        <div className={styles.content}>
          <Brand entrypoint={entrypoint} />
          <div className={styles.account}>
            <h1 className={styles.heading}>{title}</h1>
            <p className={styles.description}>
              El panel de administración estará disponible más adelante.
            </p>
            <LogoutButton entrypoint={entrypoint} className={styles.link} />
          </div>
        </div>
        <Waves />
      </div>
    </main>
  );
}
