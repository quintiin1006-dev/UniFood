import type { ReactNode } from "react";
import styles from "./WorkerPanel.module.css";

/**
 * The header of a worker panel, the one of Llamadas (F4): a 52 px icon box, the title, an
 * optional subtitle (Historial's date) and a counter or summary on the right, over a thin
 * divider. Llamadas, Historial and Disponibilidad all use it.
 */
export function PanelHeader({
  icon,
  title,
  titleId,
  subtitle,
  aside,
  level = 2,
}: {
  icon: ReactNode;
  title: string;
  titleId?: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className={styles.header}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.heading}>
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {aside !== undefined && <div className={styles.summary}>{aside}</div>}
    </header>
  );
}

/** The round counter on the right of the header (Llamadas: orders waiting). */
export function PanelCounter({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <span className={styles.counter} aria-label={label}>
      {children}
    </span>
  );
}

/** One translucent ghost block of the loading state, with the size of the content it stands for. */
export function SkeletonBlock({
  height,
  width,
  className,
}: {
  height: number;
  width?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`${styles.skeleton}${className ? ` ${className}` : ""}`}
      style={{
        height: `calc(${height}px / var(--worker-zoom, 1))`,
        width: typeof width === "number" ? `${width}px` : width,
      }}
      aria-hidden="true"
    />
  );
}

export { styles as panelStyles };
