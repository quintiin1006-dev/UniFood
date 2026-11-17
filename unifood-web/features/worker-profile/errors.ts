import { SESSION_CHECK_UNAVAILABLE } from "@/lib/messages";
import { BACKEND_ERROR_MESSAGES } from "@/features/shared/messages";
export const PROFILE_MESSAGES = {
  WORKER_PROFILE_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar tu perfil.",
  WORKER_PROFILE_FORBIDDEN: BACKEND_ERROR_MESSAGES.WORKER_PROFILE_FORBIDDEN,
  WORKER_PROFILE_TEMPORARILY_UNAVAILABLE:
    BACKEND_ERROR_MESSAGES.WORKER_PROFILE_TEMPORARILY_UNAVAILABLE,
  WORKER_PROFILE_INTERNAL_ERROR:
    BACKEND_ERROR_MESSAGES.WORKER_PROFILE_INTERNAL_ERROR,
  WORKER_PROFILE_BAD_GATEWAY:
    "No pudimos cargar un perfil válido. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE: SESSION_CHECK_UNAVAILABLE,
} as const;
export function profileErrorCode(
  status: number,
  code?: unknown,
): keyof typeof PROFILE_MESSAGES {
  if (status === 401) return "WORKER_PROFILE_UNAUTHORIZED";
  if (status === 403) return "WORKER_PROFILE_FORBIDDEN";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "WORKER_PROFILE_TEMPORARILY_UNAVAILABLE";
  return status === 500
    ? "WORKER_PROFILE_INTERNAL_ERROR"
    : "WORKER_PROFILE_BAD_GATEWAY";
}
export class WorkerProfileError extends Error {
  constructor(
    readonly status: number,
    readonly code = profileErrorCode(status),
  ) {
    super(PROFILE_MESSAGES[code]);
    this.name = "WorkerProfileError";
  }
}
