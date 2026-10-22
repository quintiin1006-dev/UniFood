export const CATALOG_MESSAGES = {
  ADMIN_CATALOG_INVALID_REQUEST: "Revisa los datos del producto.",
  ADMIN_CATALOG_PRODUCT_NOT_FOUND:
    "El producto no está disponible en tu catálogo.",
  ADMIN_CATALOG_STALE_VERSION:
    "El producto cambió. Actualiza el catálogo antes de guardar.",
  ADMIN_CATALOG_DUPLICATE_NAME:
    "Ya existe un producto con ese nombre en tu cafetería.",
  ADMIN_CATALOG_CAFETERIA_INACTIVE:
    "La cafetería está inactiva. Los cambios están deshabilitados.",
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
  if (status === 400) return "ADMIN_CATALOG_INVALID_REQUEST";
  if (status === 404) return "ADMIN_CATALOG_PRODUCT_NOT_FOUND";
  if (status === 409)
    return code === "ADMIN_CATALOG_DUPLICATE_NAME"
      ? code
      : "ADMIN_CATALOG_STALE_VERSION";
  if (status === 401) return "ADMIN_CATALOG_UNAUTHORIZED";
  if (status === 403)
    return code === "ADMIN_CATALOG_CAFETERIA_INACTIVE"
      ? code
      : "ADMIN_CATALOG_FORBIDDEN";
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
