/**
 * Service fee on screen (docs/modelo-de-negocio.md). The browser never computes the fee: it
 * reads it from the menu (to show it before confirming) or from the order (frozen by Spring).
 * A fee of 0, or none at all, shows nothing new.
 */

/** chk_orders_service_fee (033): whole pesos from 0 to 2000. */
export const MAX_SERVICE_FEE = 2000;

/**
 * The fee as Spring sends it: an integer (menu) or a decimal string like "300.00" (orders).
 * Anything else, missing or out of range, is 0: nothing is shown and nothing is guessed.
 */
export function readServiceFee(value: unknown): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,4}(\.00?)?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(amount) && amount >= 0 && amount <= MAX_SERVICE_FEE
    ? amount
    : 0;
}

/** Products and fee of a total that already includes the fee; null when there is no fee. */
export function feeBreakdown(
  total: number,
  serviceFee: number,
): { products: number; serviceFee: number } | null {
  if (!(serviceFee > 0) || !Number.isFinite(total) || total < serviceFee)
    return null;
  return { products: total - serviceFee, serviceFee };
}
