import { SESSION_CHECK_UNAVAILABLE } from "@/lib/messages";
import { BACKEND_ERROR_MESSAGES } from "@/features/shared/messages";
export const HISTORY_MESSAGES = {
  WORKER_HISTORY_INVALID_REQUEST:
    BACKEND_ERROR_MESSAGES.WORKER_HISTORY_INVALID_REQUEST,
  WORKER_HISTORY_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar el historial.",
  WORKER_HISTORY_FORBIDDEN: BACKEND_ERROR_MESSAGES.WORKER_HISTORY_FORBIDDEN,
  WORKER_HISTORY_TEMPORARILY_UNAVAILABLE:
    BACKEND_ERROR_MESSAGES.WORKER_HISTORY_TEMPORARILY_UNAVAILABLE,
  WORKER_HISTORY_BAD_GATEWAY:
    "No pudimos cargar un historial válido. Inténtalo nuevamente.",
  WORKER_HISTORY_INTERNAL_ERROR:
    BACKEND_ERROR_MESSAGES.WORKER_HISTORY_INTERNAL_ERROR,
  AUTH_TEMPORARILY_UNAVAILABLE: SESSION_CHECK_UNAVAILABLE,
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
