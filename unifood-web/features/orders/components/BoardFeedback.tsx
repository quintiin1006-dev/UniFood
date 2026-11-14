"use client";

import { CircleAlert, RefreshCw, SearchX } from "lucide-react";

import type { ListingErrorView } from "../listingStatus";
import { STALE_LISTING_MESSAGE } from "../listingStatus";

import styles from "./BoardFeedback.module.css";

/**
 * States of the worker's order listing (docs/ui-paneles.md, W1, W2, W5, L1 and L2). Static: no
 * entrance animation, so a polling refresh never makes anything move.
 */

export function BoardLoading() {
  return (
    <section className={styles.state}>
      <div className={styles.panel} role="status">
        <p className={styles.title}>Cargando pedidos…</p>
      </div>
    </section>
  );
}

export function BoardError({
  view,
  retrying,
  onRetry,
}: {
  view: ListingErrorView;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <section className={styles.state}>
      <div className={styles.panel} role="alert">
        <CircleAlert size={30} aria-hidden="true" className={styles.icon} />
        <h2 className={styles.title}>{view.title}</h2>
        <p className={styles.text}>{view.message}</p>
        {view.action === "retry" && (
          <button
            type="button"
            className={styles.primary}
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying || undefined}
          >
            <RefreshCw size={17} aria-hidden="true" />
            <span>{retrying ? "Reintentando…" : "Reintentar"}</span>
          </button>
        )}
        {view.action === "login" && (
          <a className={styles.primary} href="/panel/login">
            Iniciar sesión
          </a>
        )}
      </div>
    </section>
  );
}

/** Over a board that keeps showing the last orders it could read. */
export function StaleListingBanner({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={styles.banner} role="status">
      <CircleAlert size={20} aria-hidden="true" />
      <p>{STALE_LISTING_MESSAGE}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying || undefined}
      >
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}

export function SearchEmpty({
  query,
  scope,
  onClear,
}: {
  query: string;
  scope?: string;
  onClear: () => void;
}) {
  return (
    <section className={styles.state}>
      <div className={styles.panel} role="status">
        <SearchX size={30} aria-hidden="true" className={styles.icon} />
        <h2 className={styles.title}>
          {`Ningún pedido${scope ? ` ${scope}` : ""} coincide con “${query.trim()}”.`}
        </h2>
        <p className={styles.text}>Busca por nombre, código o producto.</p>
        <button type="button" className={styles.secondary} onClick={onClear}>
          Limpiar búsqueda
        </button>
      </div>
    </section>
  );
}

/** Screen-reader announcement of order changes; invisible on screen (W8). */
export function BoardAnnouncer({ message }: { message: string }) {
  return (
    <p className={styles.srOnly} role="status" aria-live="polite">
      {message}
    </p>
  );
}
