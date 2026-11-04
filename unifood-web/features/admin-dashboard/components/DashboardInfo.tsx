"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import styles from "./AdminDashboard.module.css";

/** Native disclosure: click, touch, Enter/Space and Escape; never hover-only. */
export function DashboardInfo({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details
      className={styles.infoDisclosure}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <Info size={15} aria-hidden="true" />
      </summary>
      <div className={styles.infoPopover}>{children}</div>
    </details>
  );
}
