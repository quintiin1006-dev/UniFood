"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import Image from "next/image";

import {
  Search,
  X,
} from "lucide-react";

import styles from "./Header.module.css";

interface HeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
}

const searchInputId = "worker-search-input";

export default function Header({
  search,
  onSearchChange,
}: HeaderProps) {
  const [
    mobileSearchOpen,
    setMobileSearchOpen,
  ] = useState(false);

  const inputRef =
    useRef<HTMLInputElement>(null);

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

        <div className={styles.brandInfo}>
          <h1>
            Uni<span>Food</span>
          </h1>

          <p>Gestión de pedidos</p>
        </div>
      </div>

      <div className={styles.actions}>
        <div
          className={`${styles.search} ${
            mobileSearchOpen
              ? styles.searchOpen
              : ""
          }`}
          role="search"
        >
          <button
            type="button"
            className={styles.searchToggle}
            onClick={() =>
              setMobileSearchOpen(
                (open) => !open
              )
            }
            aria-label={
              mobileSearchOpen
                ? "Cerrar búsqueda"
                : "Abrir búsqueda"
            }
            aria-expanded={
              mobileSearchOpen
            }
            aria-controls={
              searchInputId
            }
          >
            <Search
              size={19}
              strokeWidth={2.2}
            />
          </button>

          <input
            ref={inputRef}
            id={searchInputId}
            type="search"
            value={search}
            onChange={(event) =>
              onSearchChange(
                event.target.value
              )
            }
            placeholder="Buscar estudiante o producto..."
            aria-label="Buscar estudiante o producto"
            onKeyDown={(event) => {
              if (
                event.key === "Escape"
              ) {
                setMobileSearchOpen(
                  false
                );
              }
            }}
          />

          {mobileSearchOpen && (
            <button
              type="button"
              className={
                styles.searchClose
              }
              onClick={() =>
                setMobileSearchOpen(false)
              }
              aria-label="Cerrar búsqueda"
            >
              <X
                size={18}
                strokeWidth={2.4}
              />
            </button>
          )}
        </div>

        <div className={styles.status}>
          <span className={styles.statusDot} />

          <span>En línea</span>
        </div>
      </div>
    </header>
  );
}