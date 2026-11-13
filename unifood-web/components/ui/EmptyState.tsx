import type { ReactNode } from "react";

import styles from "./ui.module.css";

/** Calm empty state: icon, one sentence and at most one action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty} role="status">
      {icon && <span className={styles.emptyIcon}>{icon}</span>}
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.emptyText}>{children}</p>}
      {action}
    </div>
  );
}
