import { Icon } from "@/components/ui/Icon";
import { CLOSED_BANNER_BODY, CLOSED_BANNER_TITLE } from "../../shared/messages";
import styles from "./ClosedBanner.module.css";

/**
 * Shown where the carousel is while the cafeteria is closed: large, first on screen, and
 * announced once when it appears. Its height is fixed, so the page below does not move.
 */
export default function ClosedBanner() {
  return (
    <section
      className={styles.banner}
      role="status"
      aria-label={CLOSED_BANNER_TITLE}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon name="reloj" size={32} />
      </span>
      <p className={styles.title}>{CLOSED_BANNER_TITLE}</p>
      <p className={styles.body}>{CLOSED_BANNER_BODY}</p>
    </section>
  );
}
