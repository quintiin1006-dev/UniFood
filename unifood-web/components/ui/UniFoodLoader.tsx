import styles from "./loader.module.css";

/**
 * Full-screen loading state: the UniFood mark with a ring turning around it (ola 2, D1).
 * The whole loader is invisible for the first 300 ms, so a fast load never flashes.
 * Reduced motion keeps the ring still; the state is still announced to screen readers.
 */
export function UniFoodLoader({ label = "Cargando" }: { label?: string }) {
  return (
    <div className={styles.loader} role="status" aria-live="polite">
      <div className={styles.stage}>
        <svg className={styles.ring} viewBox="0 0 120 120" aria-hidden="true">
          <circle className={styles.track} cx="60" cy="60" r="56" />
          <circle className={styles.arc} cx="60" cy="60" r="56" />
        </svg>
        <img
          className={styles.mark}
          src="/unifood-mark.svg"
          alt=""
          width={72}
          height={72}
        />
      </div>
      <p className={styles.label}>{label}…</p>
    </div>
  );
}
