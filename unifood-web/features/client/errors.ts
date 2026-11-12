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

const RETRY_MESSAGE =
  "No pudimos enviar tu pedido en este momento. Revisa tu conexión e inténtalo de nuevo; tu carrito se conserva.";
const GONE_MESSAGE =
  "Esta cafetería ya no está disponible. Elige otra para hacer tu pedido.";

const byCode: Record<string, CheckoutError> = {
  CAFETERIA_CLOSED: make(
    "CAFETERIA_CLOSED",
    "La cafetería está cerrada en este momento. Tu carrito se conserva; podrás pedir cuando abra.",
    "menu",
  ),
  PRODUCT_UNAVAILABLE: make(
    "PRODUCT_UNAVAILABLE",
    "Uno de los productos ya no está disponible. Actualiza tu carrito para continuar.",
    "cart",
  ),
  ACTIVE_ORDER_EXISTS: make(
    "ACTIVE_ORDER_EXISTS",
    "Ya tienes un pedido en curso. Recógelo o cancélalo antes de hacer otro.",
    "home",
  ),
  IDEMPOTENCY_KEY_CONFLICT: make(
    "IDEMPOTENCY_KEY_CONFLICT",
    "Tu pedido cambió mientras se enviaba. Revisa el resumen y confirma de nuevo.",
    "retry",
    true,
  ),
  INVALID_PICKUP_TIME: make(
    "INVALID_PICKUP_TIME",
    "La hora de recogida ya no es válida. Elige una hora de hoy posterior a la actual o envía el pedido lo antes posible.",
    "time",
  ),
  ORDER_NOTE_TOO_LONG: make(
    "ORDER_NOTE_TOO_LONG",
    "La nota admite hasta 200 caracteres.",
    "note",
  ),
  ORDER_LIMIT_EXCEEDED: make(
    "ORDER_LIMIT_EXCEEDED",
    "Un pedido admite hasta 10 unidades por producto y 15 en total. Ajusta tu carrito.",
    "cart",
  ),
  INVALID_ORDER_REQUEST: make(
    "INVALID_ORDER_REQUEST",
    "No pudimos validar tu pedido. Revisa tu carrito e inténtalo de nuevo.",
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
