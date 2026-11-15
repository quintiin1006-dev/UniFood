// Fixed Spanish messages for the board's transitions and the rejection (docs/ui-paneles.md, W4).
// Chosen by the code of Spring's ApiErrorResponse; Spring's text never reaches the worker,
// as the reminders already do in calledOrderActions.ts.
import { ORDER_STATE_CHANGED, SESSION_EXPIRED } from "@/lib/messages";
import { BACKEND_ERROR_MESSAGES } from "@/features/shared/messages";

export { ORDER_STATE_CHANGED };

/** FIFO of the day (docs/decisiones.md §6): only the oldest PENDING of today can be prepared. */
export const ORDER_SEQUENCE_MESSAGE =
  BACKEND_ERROR_MESSAGES.ORDER_PROCESSING_SEQUENCE_VIOLATION;

export const isSequenceViolation = (code: unknown) =>
  code === "ORDER_PROCESSING_SEQUENCE_VIOLATION";

function common(status: number): string | null {
  if (status === 401) return SESSION_EXPIRED;
  if (status === 403) return "No tienes permisos para gestionar este pedido.";
  if (status === 0 || status >= 500)
    return "No pudimos guardar el cambio. Revisa la conexión e inténtalo de nuevo.";
  return null;
}

/** Preparar, listo, llamar y entregar. */
export function orderActionMessage(status: number, code: unknown): string {
  if (isSequenceViolation(code)) return ORDER_SEQUENCE_MESSAGE;
  if (
    code === "INVALID_ORDER_STATE" ||
    code === "ORDER_CONCURRENT_MODIFICATION" ||
    code === "ORDER_CANCELLED_BY_CLIENT" ||
    status === 404 ||
    status === 409
  )
    return code === "ORDER_CANCELLED_BY_CLIENT"
      ? BACKEND_ERROR_MESSAGES.ORDER_CANCELLED_BY_CLIENT
      : ORDER_STATE_CHANGED;
  return (
    common(status) ?? "No se pudo actualizar el pedido. Inténtalo de nuevo."
  );
}

/** Rejection with a reason (B18). */
export function rejectionMessage(status: number, code: unknown): string {
  if (code === "REJECTION_REASON_REQUIRED")
    return BACKEND_ERROR_MESSAGES.REJECTION_REASON_REQUIRED;
  if (code === "REJECTION_REASON_TOO_LONG")
    return BACKEND_ERROR_MESSAGES.REJECTION_REASON_TOO_LONG;
  if (
    code === "INVALID_ORDER_STATE" ||
    code === "ORDER_CONCURRENT_MODIFICATION" ||
    status === 409
  )
    return "El pedido cambió de estado y ya no se puede rechazar. Revisa el tablero actualizado.";
  return common(status) ?? "No se pudo rechazar el pedido. Inténtalo de nuevo.";
}
