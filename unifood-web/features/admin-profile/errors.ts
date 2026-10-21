export const PROFILE_MESSAGES = {
  ADMIN_PROFILE_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar tu perfil.",
  ADMIN_PROFILE_FORBIDDEN: "No tienes permisos para consultar este perfil.",
  ADMIN_PROFILE_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu perfil en este momento. Inténtalo nuevamente.",
  ADMIN_PROFILE_INTERNAL_ERROR:
    "No pudimos cargar tu perfil. Inténtalo nuevamente.",
  ADMIN_PROFILE_BAD_GATEWAY:
    "No pudimos cargar un perfil válido. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE:
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
} as const;
export function profileErrorCode(
  status: number,
  code?: unknown,
): keyof typeof PROFILE_MESSAGES {
  if (status === 401) return "ADMIN_PROFILE_UNAUTHORIZED";
  if (status === 403) return "ADMIN_PROFILE_FORBIDDEN";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "ADMIN_PROFILE_TEMPORARILY_UNAVAILABLE";
  return status === 500
    ? "ADMIN_PROFILE_INTERNAL_ERROR"
    : "ADMIN_PROFILE_BAD_GATEWAY";
}
export class AdminProfileError extends Error {
  constructor(
    readonly status: number,
    readonly code = profileErrorCode(status),
  ) {
    super(PROFILE_MESSAGES[code]);
    this.name = "AdminProfileError";
  }
}
