"use client";

import { useEffect, useRef, useState } from "react";

import Image from "next/image";

import { Icon, ICON_MIN_20 } from "@/components/ui/Icon";

import classicStyles from "./Header.classic.module.css";
import LogoutButton from "@/features/auth/components/LogoutButton";
import type { WorkerModule } from "./BottomNav";

interface HeaderProps {
  /** Pedidos and Llamadas use the classic look (ola 2 · D2); the rest keep the modern one. */
  variant?: "classic" | "modern";
  activeModule?: WorkerModule;
  search: string;
  onSearchChange: (value: string) => void;
  /** Last read of the order listing (W1); absent in modules that do not poll. */
  syncStatus?: {
    text: string;
    /** «HH:MM» alone, for the narrow pill. */
    time?: string;
    tone: "ok" | "warning" | "pending";
  };
  /** A read is in flight: the reload icon turns (D3). */
  refreshing?: boolean;
}

const searchInputId = "worker-search-input";

export default function Header({
  variant = "modern",
  activeModule = "orders",
  search,
  onSearchChange,
  syncStatus,
  refreshing = false,
}: HeaderProps) {
  // One header for the five modules: same height, logo and type (see the CSS).
  void variant;
  const styles = classicStyles;
  const showSearch = activeModule === "orders" || activeModule === "calls";
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mobileSearchOpen) {
      inputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.logoWrapper}>
          <Image
            src="/unifood-logo.png"
            alt="UniFood"
            width={64}
            height={64}
            className={styles.logo}
            priority
          />
        </div>

        {/* D1: only the brand; the nav already says which module this is. */}
        <div className={styles.brandInfo}>
          <h1>
            Uni<span>Food</span>
          </h1>
        </div>
      </div>

      {/* D2: the search takes the room between the brand and the actions. */}
      {showSearch && (
        <div className={styles.center}>
          <div
            className={`${styles.search} ${
              mobileSearchOpen ? styles.searchOpen : ""
            }`}
            role="search"
          >
            <button
              type="button"
              className={styles.searchToggle}
              onClick={() => setMobileSearchOpen((open) => !open)}
              aria-label={
                mobileSearchOpen ? "Cerrar búsqueda" : "Abrir búsqueda"
              }
              aria-expanded={mobileSearchOpen}
              aria-controls={searchInputId}
            >
              <Icon name="busqueda" size={20} style={ICON_MIN_20} />
            </button>

            <input
              ref={inputRef}
              id={searchInputId}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar estudiante o producto..."
              aria-label="Buscar estudiante o producto"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMobileSearchOpen(false);
                }
              }}
            />

            {mobileSearchOpen && (
              <button
                type="button"
                className={styles.searchClose}
                onClick={() => setMobileSearchOpen(false)}
                aria-label="Cerrar búsqueda"
              >
                <Icon name="cerrar" size={18} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {/* D3: a small glass pill; the icon turns only while the board refreshes. */}
        {syncStatus && (
          <div
            className={`${styles.status} ${
              syncStatus.tone === "warning" ? styles.statusWarning : ""
            }`}
            title={syncStatus.text}
            aria-busy={refreshing || undefined}
          >
            <Icon
              name="recargar"
              size={20}
              style={ICON_MIN_20}
              className={refreshing ? styles.statusSpin : undefined}
            />
            {syncStatus.time ? (
              <span>
                <span className={styles.statusLabel}>Actualizado a las </span>
                <time>{syncStatus.time}</time>
              </span>
            ) : (
              <span>{syncStatus.text}</span>
            )}
          </div>
        )}
        <LogoutButton entrypoint="panel" className={styles.logout} />
      </div>
    </header>
  );
}
