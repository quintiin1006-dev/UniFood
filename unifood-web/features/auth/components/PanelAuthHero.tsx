import Image from "next/image";
import styles from "./AuthScreen.module.css";

export function PanelAuthHero({
  label = "Panel UniFood",
  heading = "Tu cafetería, en un solo lugar.",
  description = "Organiza el trabajo diario y mantén tu operación al día.",
}: {
  label?: string;
  heading?: string;
  description?: string;
}) {
  return (
    <aside className={styles.panelIntro}>
      <div className={styles.panelCopy}>
        <p className={styles.panelLabel}>{label}</p>
        <h2>{heading}</h2>
        <p>{description}</p>
      </div>
      <div className={styles.panelIllustration} aria-hidden="true">
        <Image
          src="/images/client/Topos.png"
          alt=""
          fill
          sizes="(min-width: 1316px) 706px, (min-width: 960px) 56vw, 100vw"
        />
      </div>
    </aside>
  );
}
