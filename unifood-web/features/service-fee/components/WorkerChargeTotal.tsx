import type { ReactNode } from "react";
import { SERVICE_FEE_TOTAL_TO_CHARGE } from "@/features/shared/messages";
import { FeeLines } from "./FeeLines";

/**
 * The total block of the worker's order detail and of Llamadas (docs/modelo-de-negocio.md,
 * rule 7). With a fee: «Productos», «Cargo por servicio» and «Total a cobrar», always shown,
 * because that is what the counter charges. Without one it renders exactly what each screen
 * rendered before: «Total», its own class, and only when `show` says so.
 */
export function WorkerChargeTotal({
  total,
  serviceFee = 0,
  className,
  format,
  show = true,
  detail,
}: {
  /** Spring's total, which includes the fee; undefined when unknown. */
  total: number | undefined;
  serviceFee?: number;
  className: string;
  format: (amount: number) => string;
  /** Without a fee: whether the screen shows the total row at all. */
  show?: boolean;
  /** Small text next to the label, such as the units in Llamadas. */
  detail?: ReactNode;
}) {
  const charged = total !== undefined && serviceFee > 0 && total >= serviceFee;
  if (!charged && !show) return null;
  return (
    <>
      {charged && (
        <FeeLines total={total} serviceFee={serviceFee} format={format} />
      )}
      <div className={className}>
        <span>
          {charged ? SERVICE_FEE_TOTAL_TO_CHARGE : "Total"}
          {detail}
        </span>
        <strong>{total !== undefined ? format(total) : "No disponible"}</strong>
      </div>
    </>
  );
}
