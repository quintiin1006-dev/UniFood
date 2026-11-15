// Single catalogue of the response texts that several panels repeat word for word
// (docs/ui-paneles.md, «Tokens», mensajes de respuesta). Same meaning and wording as before.

export const SESSION_CHECK_UNAVAILABLE =
  "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.";

export const SESSION_EXPIRED = "Tu sesión expiró. Inicia sesión de nuevo.";

export const ORDER_STATE_CHANGED =
  "El pedido ya cambió de estado. Revisa el tablero actualizado.";

/** The server could not be reached: network, timeout or a 5xx. Never an empty result. */
export const CONNECTION_FAILED =
  "No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.";
