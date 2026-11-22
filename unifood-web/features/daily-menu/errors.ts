import { backendErrorMessage } from "../shared/messages";

/** Fallback when the backend sends no known code. */
const GENERIC = "No pudimos cargar el menú del día.";

/** The text for a daily-menu code; unknown codes get the generic one. Never a raw message. */
export function dailyMenuErrorMessage(code: unknown): string {
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
    ? backendErrorMessage(code, GENERIC)
    : GENERIC;
}
