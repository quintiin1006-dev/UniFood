export const CATALOG_MESSAGES = {
  ADMIN_CATALOG_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar el catálogo.",
  ADMIN_CATALOG_FORBIDDEN: "No tienes permisos para consultar este catálogo.",
  ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu catálogo en este momento. Inténtalo nuevamente.",
  ADMIN_CATALOG_INTERNAL_ERROR:
    "No pudimos cargar tu catálogo. Inténtalo nuevamente.",
  ADMIN_CATALOG_BAD_GATEWAY:
    "No pudimos cargar un catálogo válido. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE:
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
} as const;
export function catalogErrorCode(
  status: number,
  code?: unknown,
): keyof typeof CATALOG_MESSAGES {
  if (status === 401) return "ADMIN_CATALOG_UNAUTHORIZED";
  if (status === 403) return "ADMIN_CATALOG_FORBIDDEN";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE";
  return status === 500
    ? "ADMIN_CATALOG_INTERNAL_ERROR"
    : "ADMIN_CATALOG_BAD_GATEWAY";
}
export class AdminCatalogError extends Error {
  constructor(
    readonly status: number,
    readonly code = catalogErrorCode(status),
  ) {
    super(CATALOG_MESSAGES[code]);
    this.name = "AdminCatalogError";
  }
}
