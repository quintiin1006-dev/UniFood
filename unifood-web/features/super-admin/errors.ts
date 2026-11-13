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
  SUPER_ADMIN_INVALID_REQUEST: "La solicitud no es válida.",
  BILLING_INVALID_REQUEST:
    "Revisa el modelo de cobro y sus montos en pesos enteros.",
  CAFETERIA_NOT_FOUND: "No encontramos esa cafetería.",
  VISIBILITY_STATE_CHANGED:
    "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.",
  BILLING_STATE_CHANGED:
    "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.",
  CAFETERIA_REQUIRES_ADMIN:
    "Asigna un administrador activo antes de hacer visible esta cafetería.",
} as const;

export type SuperAdminErrorCode = keyof typeof SUPER_ADMIN_MESSAGES;

/** What the request was for: it picks the fixed message of a temporary failure. */
export type SuperAdminOperation = "list" | "save" | "audit";

const SAVE_FAILED = "No pudimos guardar el cambio. Inténtalo de nuevo.";
const AUDIT_FAILED =
  "No pudimos cargar los últimos cambios. Inténtalo de nuevo.";

/** Business codes Spring may send, per status; anything else is not trusted. */
const KEPT: Record<number, readonly SuperAdminErrorCode[]> = {
  400: ["SUPER_ADMIN_INVALID_REQUEST", "BILLING_INVALID_REQUEST"],
  404: ["CAFETERIA_NOT_FOUND"],
  409: [
    "VISIBILITY_STATE_CHANGED",
    "BILLING_STATE_CHANGED",
    "CAFETERIA_REQUIRES_ADMIN",
  ],
};

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
  const kept = KEPT[status]?.find((candidate) => candidate === code);
  return kept ?? "SUPER_ADMIN_BAD_GATEWAY";
}

export function superAdminMessage(
  code: SuperAdminErrorCode,
  operation: SuperAdminOperation = "list",
) {
  if (
    operation !== "list" &&
    [
      "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE",
      "SUPER_ADMIN_INTERNAL_ERROR",
      "SUPER_ADMIN_BAD_GATEWAY",
    ].includes(code)
  )
    return operation === "save" ? SAVE_FAILED : AUDIT_FAILED;
  return SUPER_ADMIN_MESSAGES[code];
}

export class SuperAdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: SuperAdminErrorCode = superAdminErrorCode(status),
    operation: SuperAdminOperation = "list",
  ) {
    super(superAdminMessage(code, operation));
    this.name = "SuperAdminError";
  }
}
