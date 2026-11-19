import { Icon } from "@/components/ui/Icon";
import { CLOSED_BANNER_TITLE, closedOpensAt } from "../../shared/messages";
import styles from "./ClosedBanner.module.css";

/**
 * Shown where the carousel is while the cafeteria is closed: same size and corners as the
 * carousel card, so the page below does not move. «Abre …» appears only when the opening time is
 * known; the menu does not carry it today, so nothing is invented.
 */
export default function ClosedBanner({
  opensAt = null,
}: {
  opensAt?: string | null;
}) {
  return (
    <section
      className={styles.banner}
      role="status"
      aria-label={CLOSED_BANNER_TITLE}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon name="reloj" size={44} strokeWidth={1.6} />
      </span>
      <p className={styles.title}>{CLOSED_BANNER_TITLE}</p>
      {opensAt && <p className={styles.body}>{closedOpensAt(opensAt)}</p>}
    </section>
  );
}
