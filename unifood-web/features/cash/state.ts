import {
  DENOMINATIONS,
  MAX_AMOUNT,
  MAX_QUANTITY,
  type CountLine,
} from "./types";

// Pure logic of the cash screens, without React, so it is tested on its own. Every total here
// is only a live preview for the cashier: the server computes the figures that are stored.

/** Quantities per denomination, as typed by the cashier (digits only, may be empty). */
export type CountDraft = Record<number, string>;

export const emptyCount = (): CountDraft =>
  Object.fromEntries(DENOMINATIONS.map((d) => [d, ""]));

/** Keeps digits only and caps the quantity, so a pasted «1.000» or «-3» never slips in. */
export function sanitizeQuantity(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits === "") return "";
  return String(Math.min(Number(digits.slice(0, 6)), MAX_QUANTITY));
}

export function countLines(draft: CountDraft): CountLine[] {
  return DENOMINATIONS.map((denomination) => ({
    denomination,
    quantity: Number(draft[denomination] || 0),
  }));
}

/** Integer total of a count; every product is exact (at most 10.000 × 50.000). */
export const countTotal = (draft: CountDraft) =>
  countLines(draft).reduce(
    (total, line) => total + line.denomination * line.quantity,
    0,
  );

export const lineSubtotal = (draft: CountDraft, denomination: number) =>
  denomination * Number(draft[denomination] || 0);

/** A peso amount typed with or without thousand separators; null if it is not whole. */
export function parsePesos(value: string): number | null {
  const clean = value.replace(/[\s$.]/g, "");
  if (!/^\d{1,9}$/.test(clean)) return null;
  const amount = Number(clean);
  return amount <= MAX_AMOUNT ? amount : null;
}

export const reasonValid = (reason: string, min = 3, max = 200) => {
  const length = [...reason.trim()].length;
  return length >= min && length <= max;
};

export const NOTE_MIN = 10;
export const NOTE_MAX = 500;

/** The four steps of a close: count, compare, note (only with a difference), confirm. */
export type CloseStep = "count" | "compare" | "note" | "confirm";

export function nextStep(step: CloseStep, difference: number): CloseStep {
  if (step === "count") return "compare";
  if (step === "compare") return difference === 0 ? "confirm" : "note";
  return "confirm";
}

export function previousStep(step: CloseStep, difference: number): CloseStep {
  if (step === "confirm") return difference === 0 ? "compare" : "note";
  if (step === "note") return "compare";
  return "count";
}

/** Error text of the note, or null when it may continue. */
export function noteError(note: string, difference: number): string | null {
  const length = [...note.trim()].length;
  if (difference !== 0 && length < NOTE_MIN)
    return `Explica la diferencia con al menos ${NOTE_MIN} caracteres.`;
  if (length > 0 && length < NOTE_MIN)
    return `La nota necesita al menos ${NOTE_MIN} caracteres.`;
  if (length > NOTE_MAX)
    return `La nota puede tener hasta ${NOTE_MAX} caracteres.`;
  return null;
}

/** Steps shown as 1 to 4; without a difference the note step is skipped. */
export function stepNumber(step: CloseStep): number {
  return { count: 1, compare: 2, note: 3, confirm: 4 }[step];
}
