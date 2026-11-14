"use client";

import { useEffect } from "react";
import { CircleAlert, X } from "lucide-react";

import styles from "./OrderActionAlert.module.css";

/**
 * Error of a board action (docs/ui-paneles.md, W3). It does not block the board: no overlay,
 * the other orders stay usable. Closed with its button, with Escape or by the next action.
 */
export function OrderActionAlert({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.alert} role="alert">
      <CircleAlert size={26} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <p className={styles.message}>{message}</p>
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Cerrar aviso"
      >
        <X size={24} aria-hidden="true" />
      </button>
    </div>
  );
}
