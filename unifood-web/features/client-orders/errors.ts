import {
  BACKEND_ERROR_MESSAGES,
  CLIENT_ORDER_CHANGED,
  CLIENT_ORDERS_FORBIDDEN,
  CONNECTION_FAILED,
  SESSION_EXPIRED,
} from "../shared/messages";

export type OrderFailure = {
  message: string;
  /** The request got no usable answer: offer «Reintentar»; it is not «sin resultados». */
  connection: boolean;
  /** The session is over; the page must ask for a new login. */
  login: boolean;
};

const make = (
  message: string,
  connection = false,
  login = false,
): OrderFailure => ({ message, connection, login });

export const connectionFailure = () => make(CONNECTION_FAILED, true);

/** A fixed message from the catalogue per status and code; Spring's text never reaches the screen. */
export function orderFailure(status: number, code?: string): OrderFailure {
  if (status === 401) return make(SESSION_EXPIRED, false, true);
  if (code && Object.hasOwn(BACKEND_ERROR_MESSAGES, code))
    return make(
      BACKEND_ERROR_MESSAGES[code as keyof typeof BACKEND_ERROR_MESSAGES],
    );
  if (status === 403) return make(CLIENT_ORDERS_FORBIDDEN);
  if (status === 404) return make(BACKEND_ERROR_MESSAGES.ORDER_NOT_FOUND);
  return connectionFailure();
}

/** Cancel: the 409 codes of §11 map to the catalogue; anything unknown is a retry, not a guess. */
export function cancelFailure(status: number, code?: string): OrderFailure {
  if (status === 409 && code === "ORDER_ALREADY_PREPARING")
    return make(BACKEND_ERROR_MESSAGES.ORDER_ALREADY_PREPARING);
  if (status === 409) return make(CLIENT_ORDER_CHANGED);
  return orderFailure(status, code);
}
