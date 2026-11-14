import { SESSION_CHECK_UNAVAILABLE } from "@/lib/messages";
export const DASHBOARD_MESSAGES = {
  ADMIN_DASHBOARD_INVALID_REQUEST: "Revisa los filtros del período.",
  UNAUTHORIZED:
    "Tu sesión no está disponible. Inicia sesión para consultar el dashboard.",
  ADMIN_DASHBOARD_FORBIDDEN:
    "No tienes permisos para consultar este dashboard.",
  ADMIN_DASHBOARD_INTERNAL_ERROR: "No pudimos cargar el dashboard.",
  ADMIN_DASHBOARD_BAD_GATEWAY:
    "No pudimos obtener una respuesta válida del dashboard. Inténtalo nuevamente.",
  ADMIN_DASHBOARD_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar el dashboard. Inténtalo nuevamente.",
  AUTH_TEMPORARILY_UNAVAILABLE: SESSION_CHECK_UNAVAILABLE,
} as const;
export function dashboardErrorCode(
  status: number,
  code?: unknown,
): keyof typeof DASHBOARD_MESSAGES {
  if (status === 400) return "ADMIN_DASHBOARD_INVALID_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "ADMIN_DASHBOARD_FORBIDDEN";
  if (status === 500) return "ADMIN_DASHBOARD_INTERNAL_ERROR";
  if (status === 503)
    return code === "AUTH_TEMPORARILY_UNAVAILABLE"
      ? code
      : "ADMIN_DASHBOARD_TEMPORARILY_UNAVAILABLE";
  return "ADMIN_DASHBOARD_BAD_GATEWAY";
}
export class AdminDashboardError extends Error {
  constructor(
    readonly status: number,
    readonly code = dashboardErrorCode(status),
  ) {
    super(DASHBOARD_MESSAGES[code]);
    this.name = "AdminDashboardError";
  }
}
