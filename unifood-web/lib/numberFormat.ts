/**
 * One money and one percentage format for every panel (docs/ui-paneles.md, I6):
 * Colombian pesos without decimals («$22.500») and percentages with at most one decimal
 * («33,3 %», «100 %»). Values arrive as exact decimal strings (NUMERIC from Spring) or as
 * numbers; rounding is half up on the exact decimal, never through floating point, so large
 * amounts keep every digit.
 */

/** Non-breaking space between the number and «%», so the sign never wraps alone. */
const NBSP = " ";

type Decimal = { negative: boolean; whole: string; fraction: string };

function parseDecimal(value: string | number): Decimal | null {
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(6)
        : ""
      : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return {
    negative: match[1] === "-",
    whole: match[2],
    fraction: match[3] ?? "",
  };
}

/** Rounds half up to `digits` decimals; returns the scaled integer (value × 10^digits). */
function roundScaled({ whole, fraction }: Decimal, digits: number): bigint {
  const kept = fraction.slice(0, digits).padEnd(digits, "0");
  const next = fraction.charAt(digits);
  const scaled = BigInt(whole + kept);
  return next !== "" && Number(next) >= 5 ? scaled + BigInt(1) : scaled;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** «$22.500». Returns null for a value that is not a decimal number. */
export function formatCop(value: string | number): string | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  const pesos = roundScaled(parsed, 0);
  const sign = parsed.negative && pesos !== BigInt(0) ? "-" : "";
  return `${sign}$${group(pesos.toString())}`;
}

/** «33,3 %», «100 %». Returns null for a value that is not a decimal number. */
export function formatPercentage(value: string | number): string | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  const tenths = roundScaled(parsed, 1);
  const whole = tenths / BigInt(10);
  const decimal = tenths % BigInt(10);
  const sign = parsed.negative && tenths !== BigInt(0) ? "-" : "";
  const number =
    decimal === BigInt(0)
      ? group(whole.toString())
      : `${group(whole.toString())},${decimal.toString()}`;
  return `${sign}${number}${NBSP}%`;
}
