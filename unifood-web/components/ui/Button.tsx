import type { ButtonHTMLAttributes } from "react";

import { Spinner } from "./Spinner";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "success" | "danger" | "secondary";

/** Class names of a button, also for links that act as buttons («Iniciar sesión»). */
export function buttonClass(variant: ButtonVariant = "primary", touch = false) {
  return `${styles.button} ${styles[`button_${variant}`]} ${
    touch ? styles.button_touch : ""
  }`;
}

/**
 * Primary in brand, success for «listo», danger as an outline that is never larger than the
 * primary, secondary in white. `touch` is the worker's 56 px height; the default is 48 px.
 */
export function Button({
  variant = "primary",
  touch = false,
  loading = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  touch?: boolean;
  /** Waiting for the server: spinner, aria-busy and no second click. The caller sets the text. */
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant, touch)} ${className ?? ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
