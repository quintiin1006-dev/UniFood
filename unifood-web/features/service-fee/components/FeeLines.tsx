import {
  SERVICE_FEE_BREAKDOWN_LABEL,
  SERVICE_FEE_LABEL,
  SERVICE_FEE_PRODUCTS,
} from "@/features/shared/messages";
import { feeBreakdown } from "../presentation";
import styles from "./FeeLines.module.css";

/**
 * «Productos» and «Cargo por servicio» above a total that already includes the fee. Nothing
 * when the fee is 0, so orders without a fee (and the flag off) look exactly as before.
 */
export function FeeLines({
  total,
  serviceFee,
  format,
}: {
  total: number;
  serviceFee: number;
  format: (amount: number) => string;
}) {
  const parts = feeBreakdown(total, serviceFee);
  if (!parts) return null;
  return (
    <dl className={styles.lines} aria-label={SERVICE_FEE_BREAKDOWN_LABEL}>
      <div>
        <dt>{SERVICE_FEE_PRODUCTS}</dt>
        <dd>{format(parts.products)}</dd>
      </div>
      <div>
        <dt>{SERVICE_FEE_LABEL}</dt>
        <dd>{format(parts.serviceFee)}</dd>
      </div>
    </dl>
  );
}
