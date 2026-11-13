import type { ReactNode } from "react";

import styles from "./ui.module.css";

export type NoticeTone = "success" | "error" | "info";

/**
 * The response message of every panel: success in green, error in red, warning or information
 * in brand-tint. An error is an alert; the others are polite statuses. `floating` turns it into
 * a toast at the bottom of the screen.
 */
export function Notice({
  tone,
  title,
  children,
  action,
  floating = false,
  className,
  id,
}: {
  tone: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  floating?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`${styles.notice} ${styles[`notice_${tone}`]} ${
        floating ? styles.notice_floating : ""
      } ${className ?? ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className={styles.noticeBody}>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        <div className={styles.noticeText}>{children}</div>
      </div>
      {action}
    </div>
  );
}
