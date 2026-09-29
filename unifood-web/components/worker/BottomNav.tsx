"use client";

import {
  FileText,
  History,
  Megaphone,
  Package,
  UserRound,
} from "lucide-react";

import styles from "./BottomNav.module.css";

export type WorkerModule =
  | "orders"
  | "calls"
  | "history"
  | "inventory"
  | "profile";

interface BottomNavProps {
  activeModule: WorkerModule;
  onChange: (
    module: WorkerModule
  ) => void;
}

const modules = [
  {
    id: "orders" as const,
    label: "Pedidos",
    icon: FileText,
  },
  {
    id: "calls" as const,
    label: "Llamadas",
    icon: Megaphone,
  },
  {
    id: "history" as const,
    label: "Historial",
    icon: History,
  },
  {
    id: "inventory" as const,
    label: "Inventario",
    icon: Package,
  },
  {
    id: "profile" as const,
    label: "Mi perfil",
    icon: UserRound,
  },
];

export default function BottomNav({
  activeModule,
  onChange,
}: BottomNavProps) {
  return (
    <nav
      className={styles.nav}
      aria-label="Navegación principal"
    >
      {modules.map((module) => {
        const Icon = module.icon;

        const active =
          activeModule ===
          module.id;

        return (
          <button
            key={module.id}
            type="button"
            className={`${styles.item} ${
              active
                ? styles.active
                : ""
            }`}
            onClick={() =>
              onChange(module.id)
            }
            aria-current={
              active
                ? "page"
                : undefined
            }
            aria-label={
              module.label
            }
          >
            <Icon
              size={23}
              strokeWidth={
                active ? 2.5 : 2
              }
              aria-hidden="true"
            />

            <span>
              {module.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}