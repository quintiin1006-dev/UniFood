"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";
import {
  AdminProfileProvider,
  useAdminProfile,
} from "@/features/admin-profile/context";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import styles from "./Admin.module.css";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminProfileProvider>
      <Shell>{children}</Shell>
    </AdminProfileProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { data, loading, error, retry } = useAdminProfile();
  const drawer = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => drawer.current?.close();
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) drawer.current?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#admin-content">
        Ir al contenido
      </a>
      <aside className={styles.sidebar}>
        <AdminSidebar />
      </aside>
      <div className={styles.workspace}>
        <AdminHeader
          menuOpen={menuOpen}
          openMenu={() => {
            drawer.current?.showModal();
            setMenuOpen(true);
          }}
        />
        <main id="admin-content" tabIndex={-1} className={styles.main}>
          <div className={styles.content}>
            {loading && (
              <div className={styles.feedback} role="status">
                Cargando tu espacio de administración…
              </div>
            )}
            {error && (
              <div className={styles.feedback} role="alert">
                <CircleAlert size={23} aria-hidden="true" />
                <p>{error.message}</p>
                {error.status === 401 ? (
                  <a href="/panel/login">Iniciar sesión</a>
                ) : (
                  error.status !== 403 && (
                    <button type="button" onClick={() => void retry()}>
                      Reintentar
                    </button>
                  )
                )}
              </div>
            )}
            {data && (
              <>
                {!data.cafeteria.active && (
                  <div className={styles.inactive} role="status">
                    <CircleAlert size={21} aria-hidden="true" />
                    <p>
                      <strong>La cafetería está inactiva.</strong> Puedes
                      consultar la información, pero los cambios están
                      deshabilitados.
                    </p>
                  </div>
                )}
                {children}
              </>
            )}
          </div>
        </main>
      </div>
      <dialog
        ref={drawer}
        id="admin-drawer"
        className={styles.drawer}
        aria-label="Navegación administrativa"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClose={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <button
          type="button"
          className={styles.closeMenu}
          onClick={closeMenu}
          aria-label="Cerrar navegación"
        >
          <X size={23} aria-hidden="true" />
        </button>
        <AdminSidebar onNavigate={closeMenu} />
      </dialog>
    </div>
  );
}
