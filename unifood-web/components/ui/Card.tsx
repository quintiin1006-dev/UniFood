import type { HTMLAttributes } from "react";

import styles from "./ui.module.css";

/** White container with radius 28; `raised` adds the only shadow of the system. */
export function Card({
  raised = false,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { raised?: boolean }) {
  return (
    <section
      className={`${styles.card} ${raised ? styles.card_raised : ""} ${className ?? ""}`}
      {...props}
    />
  );
}

/** Header with the «arco de la U»: large bottom corners. */
export function ArchHeader({
  tone = "tint",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  tone?: "tint" | "brand" | "success" | "neutral";
}) {
  return (
    <header
      className={`${styles.arch} ${styles[`arch_${tone}`]} ${className ?? ""}`}
      {...props}
    />
  );
}
