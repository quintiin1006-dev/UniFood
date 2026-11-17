import { SESSION_CHECK_UNAVAILABLE } from "@/lib/messages";
import { IMAGE_MESSAGES } from "./images";
import { BACKEND_ERROR_MESSAGES } from "@/features/shared/messages";
export const CATALOG_MESSAGES = {
  ...IMAGE_MESSAGES,
  ADMIN_CATALOG_INVALID_REQUEST:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_INVALID_REQUEST,
  ADMIN_CATALOG_PRODUCT_NOT_FOUND:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_PRODUCT_NOT_FOUND,
  ADMIN_CATALOG_STALE_VERSION:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_STALE_VERSION,
  ADMIN_CATALOG_DUPLICATE_NAME:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_DUPLICATE_NAME,
  ADMIN_CATALOG_CAFETERIA_INACTIVE:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_CAFETERIA_INACTIVE,
  ADMIN_CATALOG_UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar el catálogo.",
  ADMIN_CATALOG_FORBIDDEN: BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_FORBIDDEN,
  ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE,
  ADMIN_CATALOG_INTERNAL_ERROR:
    BACKEND_ERROR_MESSAGES.ADMIN_CATALOG_INTERNAL_ERROR,
  ADMIN_CATALOG_BAD_GATEWAY:
    "No pudimos cargar un catálogo válido. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE: SESSION_CHECK_UNAVAILABLE,
} as const;
export function catalogErrorCode(
  status: number,
  code?: unknown,
): keyof typeof CATALOG_MESSAGES {
  const imageStatus: Record<string, number> = {
    ADMIN_CATALOG_IMAGE_INVALID_REQUEST: 400,
    ADMIN_CATALOG_IMAGE_TOO_LARGE: 413,
    ADMIN_CATALOG_IMAGE_UNSUPPORTED_FORMAT: 415,
    ADMIN_CATALOG_IMAGE_INVALID_CONTENT: 422,
    ADMIN_CATALOG_IMAGE_IDEMPOTENCY_CONFLICT: 409,
    ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE: 503,
    ADMIN_CATALOG_IMAGE_INTERNAL_ERROR: 500,
  };
  if (
    typeof code === "string" &&
    Object.hasOwn(imageStatus, code) &&
    imageStatus[code] === status
  )
    return code as keyof typeof IMAGE_MESSAGES;
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
