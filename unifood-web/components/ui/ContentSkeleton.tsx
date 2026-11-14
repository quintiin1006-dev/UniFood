import styles from "./loader.module.css";

/**
 * Content placeholder for route changes inside a layout whose header and navigation stay fixed
 * (ola 2, D1). Static blocks; they appear after 300 ms like the full loader.
 */
export function ContentSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-live="polite"
      aria-label="Cargando contenido"
    >
      <span className={styles.skeletonTitle} />
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={styles.skeletonBlock} />
      ))}
    </div>
  );
}
