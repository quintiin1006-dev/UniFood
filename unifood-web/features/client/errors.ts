import { BACKEND_ERROR_MESSAGES } from "../shared/messages";
/**
 * What the client does when POST /api/me/orders fails. Messages are fixed Spanish copy keyed
 * by the error code; the backend text never reaches the screen (docs/decisiones.md §11).
 */
export type CheckoutAction =
  | "retry" // send again; the same Idempotency-Key is kept
  | "cart" // go back to the cart to update it
  | "menu" // back to the cafeteria menu
  | "choose" // choose another cafeteria
  | "home" // go to Inicio (there is an active order)
  | "time" // change the pickup time
  | "note" // shorten the note
  | "login"; // sign in again; the cart is kept

export type CheckoutError = {
  code: string;
  message: string;
  action: CheckoutAction;
  /** The order changed under the old key, so the next attempt needs a new one. */
  newKey: boolean;
};

const make = (
  code: string,
  message: string,
  action: CheckoutAction,
  newKey = false,
): CheckoutError => ({ code, message, action, newKey });

const RETRY_MESSAGE = BACKEND_ERROR_MESSAGES.ORDER_TEMPORARILY_UNAVAILABLE;
const GONE_MESSAGE = BACKEND_ERROR_MESSAGES.CAFETERIA_NOT_FOUND;

const byCode: Record<string, CheckoutError> = {
  CAFETERIA_CLOSED: make(
    "CAFETERIA_CLOSED",
    BACKEND_ERROR_MESSAGES.CAFETERIA_CLOSED,
    "menu",
  ),
  PRODUCT_UNAVAILABLE: make(
    "PRODUCT_UNAVAILABLE",
    BACKEND_ERROR_MESSAGES.PRODUCT_UNAVAILABLE,
    "cart",
  ),
  ACTIVE_ORDER_EXISTS: make(
    "ACTIVE_ORDER_EXISTS",
    BACKEND_ERROR_MESSAGES.ACTIVE_ORDER_EXISTS,
    "home",
  ),
  IDEMPOTENCY_KEY_CONFLICT: make(
    "IDEMPOTENCY_KEY_CONFLICT",
    BACKEND_ERROR_MESSAGES.IDEMPOTENCY_KEY_CONFLICT,
    "retry",
    true,
  ),
  INVALID_PICKUP_TIME: make(
    "INVALID_PICKUP_TIME",
    BACKEND_ERROR_MESSAGES.INVALID_PICKUP_TIME,
    "time",
  ),
  ORDER_NOTE_TOO_LONG: make(
    "ORDER_NOTE_TOO_LONG",
    BACKEND_ERROR_MESSAGES.ORDER_NOTE_TOO_LONG,
    "note",
  ),
  ORDER_LIMIT_EXCEEDED: make(
    "ORDER_LIMIT_EXCEEDED",
    BACKEND_ERROR_MESSAGES.ORDER_LIMIT_EXCEEDED,
    "cart",
  ),
  INVALID_ORDER_REQUEST: make(
    "INVALID_ORDER_REQUEST",
    BACKEND_ERROR_MESSAGES.INVALID_ORDER_REQUEST,
    "cart",
    true,
  ),
  CAFETERIA_NOT_FOUND: make("CAFETERIA_NOT_FOUND", GONE_MESSAGE, "choose"),
  CAFETERIA_NOT_SUBSCRIBED: make(
    "CAFETERIA_NOT_SUBSCRIBED",
    GONE_MESSAGE,
    "choose",
  ),
  FORBIDDEN: make(
    "FORBIDDEN",
    "Tu cuenta no puede crear pedidos en este momento.",
    "home",
  ),
  UNAUTHORIZED: make(
    "UNAUTHORIZED",
    "Tu sesión terminó. Inicia sesión de nuevo; tu carrito se conserva.",
    "login",
  ),
  ORDER_TEMPORARILY_UNAVAILABLE: make(
    "ORDER_TEMPORARILY_UNAVAILABLE",
    RETRY_MESSAGE,
    "retry",
  ),
  BACKEND_UNAVAILABLE: make("BACKEND_UNAVAILABLE", RETRY_MESSAGE, "retry"),
  AUTH_TEMPORARILY_UNAVAILABLE: make(
    "AUTH_TEMPORARILY_UNAVAILABLE",
    "No pudimos verificar tu sesión en este momento. Inténtalo de nuevo; tu carrito se conserva.",
    "retry",
  ),
};

export const NETWORK_ERROR = make("NETWORK_ERROR", RETRY_MESSAGE, "retry");

/** Maps the BFF/Spring answer to a fixed message and action; unknown codes can retry. */
export function describeOrderError(
  status: number,
  code: unknown,
): CheckoutError {
  if (typeof code === "string" && Object.hasOwn(byCode, code))
    return byCode[code];
  if (status === 401) return byCode.UNAUTHORIZED;
  if (status === 403) return byCode.FORBIDDEN;
  return make(
    "UNKNOWN",
    "No pudimos crear tu pedido. Inténtalo de nuevo; tu carrito se conserva.",
    "retry",
  );
}
