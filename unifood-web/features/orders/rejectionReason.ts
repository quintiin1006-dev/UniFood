// B18 (docs/decisiones.md §6 and §11): the same rule as Spring, so the browser and the BFF
// refuse a bad reason before the request leaves. Spring still checks it.
export const MIN_REJECTION_REASON = 3;
export const MAX_REJECTION_REASON = 200;

export type RejectionReasonCheck =
  | { ok: true; reason: string }
  | {
      ok: false;
      code: "REJECTION_REASON_REQUIRED" | "REJECTION_REASON_TOO_LONG";
      message: string;
    };

/** Characters as PostgreSQL's length() counts them: "ñ" or an emoji is one. */
export function reasonLength(text: string): number {
  return Array.from(text.trim()).length;
}

export function checkRejectionReason(value: unknown): RejectionReasonCheck {
  const reason = typeof value === "string" ? value.trim() : "";
  const length = Array.from(reason).length;
  if (length < MIN_REJECTION_REASON)
    return {
      ok: false,
      code: "REJECTION_REASON_REQUIRED",
      message: "Escribe el motivo del rechazo, con al menos 3 caracteres.",
    };
  if (length > MAX_REJECTION_REASON)
    return {
      ok: false,
      code: "REJECTION_REASON_TOO_LONG",
      message: "El motivo del rechazo admite hasta 200 caracteres.",
    };
  return { ok: true, reason };
}
