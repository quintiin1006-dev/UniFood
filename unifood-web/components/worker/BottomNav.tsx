"use client";

import { Icon, type IconName, ICON_MIN_20 } from "@/components/ui/Icon";

import modernStyles from "./BottomNav.module.css";
import classicStyles from "./BottomNav.classic.module.css";

export type WorkerModule =
  "orders" | "calls" | "history" | "availability" | "cash" | "profile";

interface BottomNavProps {
  /** Pedidos and Llamadas use the classic look (ola 2 · D2); the rest keep the modern one. */
  variant?: "classic" | "modern";
  activeModule: WorkerModule;
  onChange: (module: WorkerModule) => void;
}

const modules = [
  {
    id: "orders" as const,
    label: "Pedidos",
    icon: "pedidos" as IconName,
  },
  {
    id: "calls" as const,
    label: "Llamadas",
    icon: "llamadas" as IconName,
  },
  {
    id: "history" as const,
    label: "Historial",
    icon: "historial" as IconName,
  },
  {
    id: "availability" as const,
    label: "Disponibilidad",
    icon: "disponibilidad" as IconName,
  },
  {
    id: "cash" as const,
    label: "Caja",
    icon: "efectivo" as IconName,
  },
  {
    id: "profile" as const,
    label: "Mi perfil",
    icon: "perfil" as IconName,
  },
];

export default function BottomNav({
  variant = "modern",
  activeModule,
  onChange,
}: BottomNavProps) {
  const styles = variant === "classic" ? classicStyles : modernStyles;
  return (
    <nav className={styles.nav} aria-label="Navegación principal">
      {modules.map((module) => {
        const active = activeModule === module.id;

        return (
          <button
            key={module.id}
            type="button"
            className={`${styles.item} ${active ? styles.active : ""}`}
            onClick={() => onChange(module.id)}
            aria-current={active ? "page" : undefined}
            aria-label={module.label}
          >
            <Icon
              name={module.icon}
              size={23}
              style={ICON_MIN_20}
              tone={active ? "active" : "inherit"}
            />

            <span>{module.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
