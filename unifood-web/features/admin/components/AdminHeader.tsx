"use client";

import { Menu } from "lucide-react";
import LogoutButton from "@/features/auth/components/LogoutButton";
import { useAdminProfile } from "@/features/admin-profile/context";
import styles from "./Admin.module.css";

export function AdminHeader({
  openMenu,
  menuOpen,
}: {
  openMenu: () => void;
  menuOpen: boolean;
}) {
  const { data } = useAdminProfile();
  return (
    <header className={styles.header}>
      <button
        className={styles.menuToggle}
        type="button"
        onClick={openMenu}
        aria-label="Abrir navegación"
        aria-expanded={menuOpen}
        aria-controls="admin-drawer"
      >
        <Menu size={23} aria-hidden="true" />
      </button>
      <div className={styles.context}>
        <strong>{data?.cafeteria.name ?? "Administración de cafetería"}</strong>
        {data && (
          <span>
            {data.site.name}
            <span aria-hidden="true"> · </span>
            {data.institution.name}
          </span>
        )}
      </div>
      <LogoutButton entrypoint="panel" className={styles.logout} />
    </header>
  );
}
