"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  AdminProfileProvider,
  useAdminProfile,
} from "@/features/admin-profile/context";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import styles from "./Admin.module.css";
import { Notice } from "@/components/ui/Notice";
import { Button, buttonClass } from "@/components/ui/Button";

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
            {loading && !data && (
              <div className={styles.feedback} role="status">
                Cargando tu espacio de administración…
              </div>
            )}
            {error && (
              <Notice
                tone="error"
                className={styles.message}
                action={
                  error.status === 401 ? (
                    <a className={buttonClass("secondary")} href="/panel/login">
                      Iniciar sesión
                    </a>
                  ) : (
                    error.status !== 403 && (
                      <Button variant="secondary" onClick={() => void retry()}>
                        Reintentar
                      </Button>
                    )
                  )
                }
              >
                {error.message}
              </Notice>
            )}
            {data && (
              <>
                {!data.cafeteria.active && (
                  <Notice tone="info" className={styles.message}>
                    <p>
                      <strong>La cafetería está inactiva.</strong> Todavía no
                      está visible para los clientes, por eso el catálogo es de
                      solo consulta por ahora. Se podrá editar cuando el equipo
                      de UniFood active la cafetería.
                    </p>
                  </Notice>
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
