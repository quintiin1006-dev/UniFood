"use client";
import type { ReactNode } from "react";
import { CircleAlert, CloudOff, RefreshCw } from "lucide-react";
import { ICON_MIN_20 } from "@/components/ui/Icon";
import {
  CONNECTION_RETRY,
  CONNECTION_RETRYING,
} from "@/features/shared/messages";
import styles from "./ConnectionNotice.module.css";

/**
 * C (jj/cliente-ajustes-2): the one connection notice of the worker and the client. A network
 * drop is a calm blue strip (`offline`, a cloud), never an alarm; `error` is the same strip in a
 * soft tone for a read that left nothing to show. Red is kept for errors that stop an action.
 *
 * `surface` follows the page: `glass` on the worker's deep blue, `light` on the client. It is
 * a status (role="status"), sits in the flow and never covers content.
 */
export function ConnectionNotice({
  tone = "offline",
  surface = "light",
  children,
  onRetry,
  retrying = false,
  action,
  className,
}: {
  tone?: "offline" | "error";
  surface?: "glass" | "light";
  children: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /** Replaces «Reintentar» when another way out fits better (for example «Iniciar sesión»). */
  action?: ReactNode;
  className?: string;
}) {
  const Glyph = tone === "offline" ? CloudOff : CircleAlert;
  return (
    <div
      className={`${styles.notice} ${className ?? ""}`}
      data-tone={tone}
      data-surface={surface}
      role="status"
    >
      <Glyph
        size={20}
        style={ICON_MIN_20}
        strokeWidth={1.9}
        aria-hidden="true"
        className={styles.icon}
      />
      <div className={styles.text}>{children}</div>
      {action ??
        (onRetry && (
          <button
            type="button"
            className={styles.retry}
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying || undefined}
          >
            <RefreshCw
              size={20}
              style={ICON_MIN_20}
              aria-hidden="true"
              className={retrying ? styles.spin : undefined}
            />
            {retrying ? CONNECTION_RETRYING : CONNECTION_RETRY}
          </button>
        ))}
    </div>
  );
}
