/**
 * The fee the cart shows and sends (docs/modelo-de-negocio.md, rule 5). After a 409
 * SERVICE_FEE_CHANGED, Spring's value wins until the menu read again brings a fee of its own.
 */
export type FeeOverride = {
  /** The fee Spring answered with in the 409. */
  value: number;
  /** The menu's fee when the 409 arrived; a refreshed menu has another one. */
  menuFee: number | null;
};

/** null: the menu carries no fee (flag off), so nothing is shown or sent. */
export function shownServiceFee(
  menuFee: number | null,
  override: FeeOverride | null,
): number | null {
  if (override && override.menuFee === menuFee) return override.value;
  return menuFee;
}
