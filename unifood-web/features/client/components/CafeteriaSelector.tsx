import Link from "next/link";
import { ChevronDown, Store } from "lucide-react";
import { CHANGE_CAFETERIA_HREF } from "../domain/context";
import {
  CAFETERIA_STATUS_CLOSED,
  CAFETERIA_STATUS_OPEN,
} from "../../shared/messages";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";
import homeStyles from "./HomeSections.module.css";

/**
 * Always visible, even with a single option, so the student can change it (§4). `compact` is the
 * one-line white card of Inicio: name, site and open/closed state.
 */
export default function CafeteriaSelector({
  siteName,
  cafeteria,
  compact = false,
}: {
  siteName: string;
  cafeteria: { name: string; open: boolean };
  compact?: boolean;
}) {
  const status = cafeteria.open
    ? CAFETERIA_STATUS_OPEN
    : compact
      ? CAFETERIA_STATUS_CLOSED
      : "Cerrada por ahora";
  const label = `Cambiar cafetería. ${cafeteria.name}, ${siteName}, ${status}`;
  if (compact)
    return (
      <Link
        className={homeStyles.selector}
        href={CHANGE_CAFETERIA_HREF}
        aria-label={label}
      >
        <Store size={20} strokeWidth={1.8} aria-hidden="true" />
        <strong>{cafeteria.name}</strong>
        <span className={homeStyles.selectorSite}>{siteName}</span>
        <span className={homeStyles.selectorStatus} data-open={cafeteria.open}>
          {status}
        </span>
        <ChevronDown size={20} aria-hidden="true" />
      </Link>
    );
  return (
    <Link
      className={styles.cafeteriaSelector}
      href={CHANGE_CAFETERIA_HREF}
      aria-label={label}
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
