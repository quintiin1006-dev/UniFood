import Link from "next/link";
import { ChevronDown, Store } from "lucide-react";
import { CHANGE_CAFETERIA_HREF } from "../domain/context";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";

/** Always visible, even with a single option, so the student can change it (§4). */
export default function CafeteriaSelector({
  siteName,
  cafeteria,
}: {
  siteName: string;
  cafeteria: { name: string; open: boolean };
}) {
  const status = cafeteria.open ? "Abierta" : "Cerrada por ahora";
  return (
    <Link
      className={styles.cafeteriaSelector}
      href={CHANGE_CAFETERIA_HREF}
      aria-label={`Cambiar cafetería. ${cafeteria.name}, ${siteName}, ${status}`}
    >
      <Store size={28} strokeWidth={1.6} aria-hidden="true" />
      <span>
        <strong>{cafeteria.name}</strong>
        <small>
          {siteName} ·{" "}
          <span
            className={menuStyles.cafeteriaStatus}
            data-open={cafeteria.open}
          >
            {status}
          </span>
        </small>
      </span>
      <ChevronDown size={22} aria-hidden="true" />
    </Link>
  );
}
