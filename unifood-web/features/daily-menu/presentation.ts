import { currency } from "../client/domain/catalog";
import { dailyMenuExtra, dailyMenuMissing } from "../shared/messages";

/** The app's currency format: "$ 9.500". */
export const formatPrice = (value: number) => currency.format(value);

/** Inside an addition chip: "+ $ 2.000". */
export const formatExtra = (value: number) =>
  dailyMenuExtra(formatPrice(value));

/** The reason under the button while something is missing; null when complete. */
export const missingText = (labels: string[]) =>
  labels.length ? dailyMenuMissing(labels) : null;
