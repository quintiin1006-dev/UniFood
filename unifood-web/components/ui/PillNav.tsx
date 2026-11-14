import type { ReactNode } from "react";

import styles from "./ui.module.css";

export type PillNavItem<T extends string> = {
  id: T;
  label: string;
  icon?: ReactNode;
};

/** Pill-shaped bottom navigation or tabs; the active item carries aria-current. */
export function PillNav<T extends string>({
  items,
  active,
  onChange,
  label,
}: {
  items: PillNavItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <nav className={styles.pillNav} aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.pillItem} ${
            item.id === active ? styles.pillItem_active : ""
          }`}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
