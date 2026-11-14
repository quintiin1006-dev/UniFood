"use client";

import { FileText, History, Megaphone, Package, UserRound } from "lucide-react";

import modernStyles from "./BottomNav.module.css";
import classicStyles from "./BottomNav.classic.module.css";

export type WorkerModule =
  "orders" | "calls" | "history" | "availability" | "profile";

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
    id: "availability" as const,
    label: "Disponibilidad",
    icon: Package,
  },
  {
    id: "profile" as const,
    label: "Mi perfil",
    icon: UserRound,
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
        const Icon = module.icon;

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
            <Icon size={23} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />

            <span>{module.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
