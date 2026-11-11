export const SUPER_ADMIN_MESSAGES = {
  SUPER_ADMIN_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para continuar.",
  SUPER_ADMIN_FORBIDDEN: "No tienes permisos para la administración global.",
  SUPER_ADMIN_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar las cafeterías en este momento.",
  SUPER_ADMIN_BAD_GATEWAY:
    "No pudimos cargar un listado válido. Inténtalo nuevamente.",
  SUPER_ADMIN_INTERNAL_ERROR: "No pudimos cargar las cafeterías.",
  AUTH_TEMPORARILY_UNAVAILABLE:
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
} as const;

export type SuperAdminErrorCode = keyof typeof SUPER_ADMIN_MESSAGES;

export function superAdminErrorCode(
  status: number,
  code?: unknown,
): SuperAdminErrorCode {
  if (status === 401) return "SUPER_ADMIN_UNAUTHORIZED";
  if (status === 403) return "SUPER_ADMIN_FORBIDDEN";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE";
  if (status === 500) return "SUPER_ADMIN_INTERNAL_ERROR";
  return "SUPER_ADMIN_BAD_GATEWAY";
}

export class SuperAdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: SuperAdminErrorCode = superAdminErrorCode(status),
  ) {
    super(SUPER_ADMIN_MESSAGES[code]);
    this.name = "SuperAdminError";
  }
}
