export const AVAILABILITY_MESSAGES = {
  AVAILABILITY_UNAUTHORIZED: "Inicia sesión para gestionar la disponibilidad.",
  AVAILABILITY_FORBIDDEN:
    "No tienes permisos para gestionar esta disponibilidad.",
  AVAILABILITY_INVALID_REQUEST:
    "Revisa el estado solicitado y la fecha de la pantalla.",
  AVAILABILITY_ITEM_NOT_FOUND:
    "El producto ya no está disponible para esta operación.",
  AVAILABILITY_CAFETERIA_NOT_FOUND: "No se pudo resolver tu cafetería.",
  AVAILABILITY_DAY_EXPIRED:
    "El día de operación cambió. Actualiza la disponibilidad para continuar.",
  AVAILABILITY_CAFETERIA_INACTIVE:
    "La cafetería está administrativamente inactiva. Solo puedes cerrar o deshabilitar productos.",
  AVAILABILITY_ITEM_INACTIVE:
    "El producto está inactivo. Actualiza la disponibilidad.",
  AVAILABILITY_CONFLICT:
    "La disponibilidad cambió. Actualiza la pantalla y vuelve a intentarlo.",
  AVAILABILITY_TEMPORARILY_UNAVAILABLE:
    "La disponibilidad no está disponible en este momento. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE:
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
  AVAILABILITY_CATALOG_INVALID:
    "El catálogo requiere una revisión administrativa.",
  AVAILABILITY_INTERNAL_ERROR: "No pudimos gestionar la disponibilidad.",
  AVAILABILITY_BAD_GATEWAY:
    "No pudimos cargar un estado válido de disponibilidad. Inténtalo nuevamente.",
} as const;
export type AvailabilityErrorCode = keyof typeof AVAILABILITY_MESSAGES;

export function publicErrorCode(
  status: number,
  value?: unknown,
): AvailabilityErrorCode {
  if (status === 401) return "AVAILABILITY_UNAUTHORIZED";
  if (status === 403) return "AVAILABILITY_FORBIDDEN";
  if (status === 400) return "AVAILABILITY_INVALID_REQUEST";
  if (status === 404)
    return value === "AVAILABILITY_CAFETERIA_NOT_FOUND"
      ? value
      : "AVAILABILITY_ITEM_NOT_FOUND";
  if (status === 409)
    return value === "AVAILABILITY_DAY_EXPIRED" ||
      value === "AVAILABILITY_CAFETERIA_INACTIVE" ||
      value === "AVAILABILITY_ITEM_INACTIVE"
      ? value
      : "AVAILABILITY_CONFLICT";
  if (status === 503)
    return value === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? value
      : "AVAILABILITY_TEMPORARILY_UNAVAILABLE";
  if (status === 500)
    return value === "AVAILABILITY_CATALOG_INVALID"
      ? value
      : "AVAILABILITY_INTERNAL_ERROR";
  return "AVAILABILITY_BAD_GATEWAY";
}
export class AvailabilityApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AvailabilityErrorCode = publicErrorCode(status),
  ) {
    super(AVAILABILITY_MESSAGES[code]);
    this.name = "AvailabilityApiError";
  }
}
