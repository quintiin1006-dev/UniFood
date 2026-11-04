"use client";

import { Menu, Store } from "lucide-react";
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
        <span className={styles.contextIcon} aria-hidden="true">
          <Store size={23} strokeWidth={1.7} />
        </span>
        <div>
          <strong>
            {data?.cafeteria.name ?? "Administración de cafetería"}
          </strong>
          {data && (
            <span className={styles.contextLocation}>
              {data.site.name}
              <span aria-hidden="true"> · </span>
              {data.institution.name}
            </span>
          )}
        </div>
      </div>
      <div className={styles.headerActions} title="Cerrar sesión">
        <LogoutButton entrypoint="panel" className={styles.logout} />
      </div>
    </header>
  );
}
