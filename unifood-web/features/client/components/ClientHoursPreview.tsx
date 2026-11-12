"use client";

import { usePathname } from "next/navigation";
import { useClientCart } from "./ClientCartProvider";
import styles from "./ClientHoursPreview.module.css";

export default function ClientHoursPreview() {
  const { ready, ignoreServiceHours, setIgnoreServiceHours } = useClientCart();
  const pathname = usePathname();
  // Only the test checkout still uses service hours; PR 2 removes this control.
  if (
    process.env.NODE_ENV !== "development" ||
    !pathname.startsWith("/cuenta/carrito")
  )
    return null;

  return (
    <aside className={styles.preview} aria-label="Pruebas de desarrollo">
      <label className={styles.control}>
        <input
          type="checkbox"
          checked={ignoreServiceHours}
          disabled={!ready}
          onChange={(event) => setIgnoreServiceHours(event.target.checked)}
          aria-describedby="hours-preview-description"
        />
        <span>Probar sin horario</span>
        <span className={styles.badge}>Desarrollo</span>
      </label>
      <p id="hours-preview-description" aria-live="polite">
        {ignoreServiceHours
          ? "Prueba a cualquier hora. La recogida respeta el horario de cada comida y, si ya pasó, muestra la próxima fecha disponible."
          : "Actívalo para probar el resumen fuera del horario de atención."}
      </p>
    </aside>
  );
}
