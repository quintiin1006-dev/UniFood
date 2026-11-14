import type { ReactNode } from "react";

import {
  ORDER_STATUS_LABELS,
  orderStatusTone,
  type OrderStatusTone,
} from "./orderStatus";
import styles from "./ui.module.css";

/** The only order state chip. `children` replaces the default label when a screen has its own. */
export function StatusChip({
  status,
  tone,
  cancellationSource,
  children,
  className,
}: {
  status?: string;
  tone?: OrderStatusTone;
  cancellationSource?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  const resolved =
    tone ?? orderStatusTone(status ?? "", cancellationSource ?? null);
  return (
    <span
      className={`${styles.chip} ${styles[`chip_${resolved}`]} ${className ?? ""}`}
      data-tone={resolved}
    >
      {children ?? ORDER_STATUS_LABELS[resolved]}
    </span>
  );
}
