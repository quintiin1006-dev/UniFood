import styles from "./ui.module.css";

/**
 * Small ring for a button that waits for the server (ola 4 · F3). It inherits the text colour,
 * so it works on brand, success and white buttons. Decorative: the button's text says the state.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`${styles.spinner} ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}
