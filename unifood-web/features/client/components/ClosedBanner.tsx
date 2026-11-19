import { Icon } from "@/components/ui/Icon";
import {
  CLOSED_BANNER_BACK_LATER,
  CLOSED_BANNER_TITLE,
  closedOpensAtTime,
} from "../../shared/messages";
import styles from "./ClosedBanner.module.css";

/**
 * Shown where the carousel is while the cafeteria is closed: same size and corners as the
 * carousel card, so the page below does not move. «Abre a las …» only when the menu brings the
 * opening time (it does not today); otherwise «Vuelve más tarde». A quiet scene in the
 * background (a wall clock, a steaming cup, a moon with a «z») moves slowly; with reduced motion
 * it stays still. It is translucent so the text keeps its contrast.
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
      <svg
        className={styles.scene}
        viewBox="0 0 320 190"
        preserveAspectRatio="xMaxYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        {/* Wall clock: the hands turn very slowly. */}
        <g transform="translate(250 58)">
          <circle r="30" className={styles.stroke} />
          <g className={styles.hourHand}>
            <line x1="0" y1="0" x2="0" y2="-14" className={styles.stroke} />
          </g>
          <g className={styles.minuteHand}>
            <line x1="0" y1="0" x2="0" y2="-22" className={styles.stroke} />
          </g>
          <circle r="2.5" className={styles.fill} />
        </g>
        {/* Cup with steam that rises and fades. */}
        <g transform="translate(232 150)">
          <path
            d="M-22 -14h40v12a20 20 0 0 1-40 0z"
            className={styles.stroke}
          />
          <path d="M18 -8h6a8 8 0 0 1 0 16h-8" className={styles.stroke} />
          <path d="M-12 -22c-6-8 6-12 0-20" className={styles.steam} />
          <path d="M-1 -22c-6-8 6-12 0-20" className={styles.steamLate} />
          <path d="M10 -22c-6-8 6-12 0-20" className={styles.steam} />
        </g>
        {/* Moon and a «z» that float. */}
        <g className={styles.float}>
          <path
            d="M296 120a16 16 0 1 1-13-26a13 13 0 0 0 13 26z"
            className={styles.fill}
          />
          <text x="300" y="88" className={styles.zed}>
            z
          </text>
        </g>
      </svg>
      <span className={styles.icon} aria-hidden="true">
        <Icon name="reloj" size={40} strokeWidth={1.6} />
      </span>
      <p className={styles.title}>{CLOSED_BANNER_TITLE}</p>
      <p className={styles.body}>
        {opensAt ? closedOpensAtTime(opensAt) : CLOSED_BANNER_BACK_LATER}
      </p>
    </section>
  );
}
