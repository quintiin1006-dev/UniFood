import {
  BACKEND_ERROR_CODES,
  BACKEND_ERROR_MESSAGES,
  CASH_TEXTS,
  CONNECTION_FAILED,
  SESSION_EXPIRED,
} from "@/features/shared/messages";

/** The CASH_* codes of the backend, as registered in the central catalogue. */
const CASH_CODES = BACKEND_ERROR_CODES.filter(
  (
    code,
  ): code is Extract<(typeof BACKEND_ERROR_CODES)[number], `CASH_${string}`> =>
    code.startsWith("CASH_"),
);

/**
 * Fixed Spanish messages per code: the BFF never relays Spring's text. A business status
 * (400, 404 or 409) without one of these codes is not trusted and becomes 502.
 */
export const CASH_MESSAGES = {
  CASH_UNAUTHENTICATED: SESSION_EXPIRED,
  ...Object.fromEntries(
    CASH_CODES.map((code) => [code, BACKEND_ERROR_MESSAGES[code]]),
  ),
  CASH_BAD_GATEWAY: CONNECTION_FAILED,
  CASH_OFFLINE: CASH_TEXTS.offlineClose,
} as Record<
  | (typeof CASH_CODES)[number]
  | "CASH_UNAUTHENTICATED"
  | "CASH_BAD_GATEWAY"
  | "CASH_OFFLINE",
  string
>;

export type CashErrorCode = keyof typeof CASH_MESSAGES;

const BUSINESS = new Set<string>(
  Object.keys(CASH_MESSAGES).filter(
    (code) =>
      ![
        "CASH_UNAUTHENTICATED",
        "CASH_INTERNAL_ERROR",
        "CASH_BAD_GATEWAY",
        "CASH_TEMPORARILY_UNAVAILABLE",
        "CASH_OFFLINE",
      ].includes(code),
  ),
);

/** The code the BFF answers with for a Spring status and its (untrusted) code. */
export function cashErrorCode(status: number, code?: unknown): CashErrorCode {
  if (status === 401) return "CASH_UNAUTHENTICATED";
  if (status === 403) return "CASH_FORBIDDEN";
  if (status === 500) return "CASH_INTERNAL_ERROR";
  if (status === 503) return "CASH_TEMPORARILY_UNAVAILABLE";
  if ([400, 404, 409].includes(status))
    return typeof code === "string" && BUSINESS.has(code)
      ? (code as CashErrorCode)
      : "CASH_BAD_GATEWAY";
  return "CASH_BAD_GATEWAY";
}

export const cashMessage = (code: CashErrorCode) => CASH_MESSAGES[code];
