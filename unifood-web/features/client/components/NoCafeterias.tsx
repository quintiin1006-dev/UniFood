import { Store } from "lucide-react";
import styles from "./ClientMenu.module.css";

/**
 * The context loaded, and it has no cafeteria at all. Nothing failed, so there is nothing to
 * retry: it only says so, with the same empty state the other catalogue screens use.
 */
export default function NoCafeterias() {
  return (
    <div className={styles.state} role="status">
      <Store size={36} strokeWidth={1.5} aria-hidden="true" />
      <h1>Aún no hay cafeterías disponibles</h1>
      <p>Vuelve a consultar más tarde.</p>
    </div>
  );
}
