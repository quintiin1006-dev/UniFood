import styles from "./AdminDashboard.module.css";

export function DashboardLoading() {
  return (
    <div className={styles.loadingLayout}>
      <p className={styles.loading} role="status">
        Consultando el período seleccionado…
      </p>
      <div className={styles.loadingSkeleton} aria-hidden="true">
        <div className={styles.countGrid}>
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.skeletonMetric} key={index}>
              <span className={styles.skeletonLabel} />
              <span className={styles.skeletonValue} />
            </div>
          ))}
        </div>
        <div className={styles.skeletonMonetary}>
          <span className={styles.skeletonLabel} />
        </div>
        <div className={styles.skeletonPanel}>
          <span className={styles.skeletonLabel} />
          <div className={styles.skeletonChart} />
        </div>
        <div className={styles.skeletonPanel}>
          <span className={styles.skeletonLabel} />
          <div className={styles.skeletonRows}>
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
