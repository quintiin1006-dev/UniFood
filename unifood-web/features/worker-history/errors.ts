export const HISTORY_MESSAGES = {
  WORKER_HISTORY_INVALID_REQUEST:
    "Los filtros o la página ya no son válidos. Actualiza el historial.",
  WORKER_HISTORY_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar el historial.",
  WORKER_HISTORY_FORBIDDEN: "No tienes permisos para consultar este historial.",
  WORKER_HISTORY_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar el historial en este momento.",
  WORKER_HISTORY_BAD_GATEWAY:
    "No pudimos cargar un historial válido. Inténtalo nuevamente.",
  WORKER_HISTORY_INTERNAL_ERROR:
    "No pudimos cargar el historial en este momento.",
  AUTH_TEMPORARILY_UNAVAILABLE:
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
} as const;
export type HistoryErrorCode = keyof typeof HISTORY_MESSAGES;
export function historyErrorCode(
  status: number,
  code?: unknown,
): HistoryErrorCode {
  if (status === 400) return "WORKER_HISTORY_INVALID_REQUEST";
  if (status === 401) return "WORKER_HISTORY_UNAUTHORIZED";
  if (status === 403) return "WORKER_HISTORY_FORBIDDEN";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "WORKER_HISTORY_TEMPORARILY_UNAVAILABLE";
  if (status === 500) return "WORKER_HISTORY_INTERNAL_ERROR";
  return "WORKER_HISTORY_BAD_GATEWAY";
}
export class WorkerHistoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: HistoryErrorCode = historyErrorCode(status),
  ) {
    super(HISTORY_MESSAGES[code]);
    this.name = "WorkerHistoryError";
  }
}
