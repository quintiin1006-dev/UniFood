/**
 * Fixed Spanish messages per code: the BFF never relays Spring's text. A business status
 * (400, 404 or 409) without one of these codes is not trusted and becomes 502.
 */
export const CASH_MESSAGES = {
  CASH_UNAUTHENTICATED: "Tu sesión terminó. Inicia sesión de nuevo.",
  CASH_FORBIDDEN: "No tienes permisos para esta operación de caja.",
  CASH_INVALID_REQUEST: "Revisa los datos e inténtalo de nuevo.",
  CASH_INVALID_AMOUNT: "Escribe un monto en pesos enteros, sin decimales.",
  CASH_REASON_REQUIRED:
    "Escribe el motivo del movimiento (de 3 a 200 caracteres).",
  CASH_NOTE_REQUIRED:
    "La caja no cuadra: explica la diferencia en una nota de al menos 10 caracteres.",
  CASH_REOPEN_REASON_REQUIRED:
    "Escribe el motivo de la reapertura (de 10 a 300 caracteres).",
  CASH_SESSION_NOT_FOUND: "No encontramos esa caja.",
  CASH_SESSION_ALREADY_OPEN:
    "Ya hay una caja abierta en esta cafetería. Ciérrala antes de continuar.",
  CASH_STALE_SESSION_OPEN:
    "Quedó abierta la caja de un día anterior. Ciérrala antes de abrir la de hoy; el administrador ya fue avisado.",
  CASH_SHIFT_ALREADY_USED:
    "La caja de este turno ya se cerró hoy. Si hace falta corregirla, pide al administrador que la reabra.",
  CASH_SESSION_CLOSED: "Esta caja ya está cerrada y no admite cambios.",
  CASH_SESSION_NOT_CLOSED: "Solo se puede reabrir una caja cerrada.",
  CASH_STATE_CHANGED:
    "La caja cambió mientras la revisabas. Revisa las cifras actuales e inténtalo de nuevo.",
  CASH_EXPECTED_CHANGED:
    "Hubo ventas o movimientos nuevos mientras contabas. Revisa el esperado actualizado.",
  CASH_PENDING_ORDERS:
    "Hay pedidos listos o llamados sin resolver. Entrégalos o márcalos como no recogidos antes de cerrar la caja.",
  CASH_EXPENSE_EXCEEDS_BALANCE:
    "El egreso supera el efectivo esperado en caja.",
  CASH_ORDER_TOTAL_NOT_WHOLE:
    "Un pedido entregado tiene centavos en su total y la caja no puede cerrarse. Avisa al administrador.",
  CASH_REOPEN_NOT_LATEST:
    "Solo se puede reabrir la última caja cerrada de la cafetería.",
  CASH_TOLERANCE_CHANGED:
    "Otra persona cambió la tolerancia. Revisa el valor actual e inténtalo de nuevo.",
  CASH_BUSY:
    "La caja está ocupada con otra operación. Inténtalo de nuevo en unos segundos.",
  CASH_TEMPORARILY_UNAVAILABLE:
    "No pudimos conectar con la caja en este momento. Inténtalo nuevamente.",
  CASH_INTERNAL_ERROR: "No pudimos completar la operación de caja.",
  CASH_BAD_GATEWAY: "Recibimos una respuesta inesperada. Inténtalo nuevamente.",
  CASH_OFFLINE:
    "Sin conexión a internet. Conéctate para continuar; no cierres la caja sin conexión.",
} as const;

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
