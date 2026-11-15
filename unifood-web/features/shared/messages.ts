// Single source of the texts the user reads (ola 4 · F5). Spanish, short, friendly, tuteo.
// Two parts: UI events shared by several screens, and one message for every ErrorCode of the
// backend (unifood-backend/.../shared/error/ErrorCode.java). tests/messages-catalog.test.mjs fails
// when the backend adds a code without a message here. The map per screen (features/*/errors.ts)
// takes its texts from this file; it only decides which code applies to each HTTP status.

import { MAX_REJECTION_REASON } from "../orders/rejectionReason";

/* ---------- UI events ---------- */

export const SESSION_CHECK_UNAVAILABLE =
  "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.";

export const SESSION_EXPIRED = "Tu sesión expiró. Inicia sesión de nuevo.";

export const ORDER_STATE_CHANGED =
  "El pedido ya cambió de estado. Revisa el tablero actualizado.";

export const OFFLINE_RETRYING = "Sin conexión. Reintentando…";

export const SAVING = "Guardando…";

/* ---------- Backend ErrorCode ---------- */

/** Mirror of the backend enum, in its order. The test compares it with ErrorCode.java. */
export const BACKEND_ERROR_CODES = [
  "ADMIN_CATALOG_FORBIDDEN",
  "ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE",
  "ADMIN_CATALOG_INTERNAL_ERROR",
  "ADMIN_CATALOG_INVALID_REQUEST",
  "ADMIN_CATALOG_PRODUCT_NOT_FOUND",
  "ADMIN_CATALOG_STALE_VERSION",
  "ADMIN_CATALOG_DUPLICATE_NAME",
  "ADMIN_CATALOG_CAFETERIA_INACTIVE",
  "ADMIN_PROFILE_FORBIDDEN",
  "ADMIN_PROFILE_TEMPORARILY_UNAVAILABLE",
  "ADMIN_PROFILE_INTERNAL_ERROR",
  "SUPER_ADMIN_FORBIDDEN",
  "SUPER_ADMIN_TEMPORARILY_UNAVAILABLE",
  "SUPER_ADMIN_INTERNAL_ERROR",
  "SUPER_ADMIN_INVALID_REQUEST",
  "BILLING_INVALID_REQUEST",
  "VISIBILITY_STATE_CHANGED",
  "BILLING_STATE_CHANGED",
  "CAFETERIA_REQUIRES_ADMIN",
  "WORKER_PROFILE_FORBIDDEN",
  "WORKER_PROFILE_TEMPORARILY_UNAVAILABLE",
  "WORKER_PROFILE_INTERNAL_ERROR",
  "WORKER_HISTORY_FORBIDDEN",
  "WORKER_HISTORY_INVALID_REQUEST",
  "WORKER_HISTORY_TEMPORARILY_UNAVAILABLE",
  "WORKER_HISTORY_INTERNAL_ERROR",
  "AVAILABILITY_FORBIDDEN",
  "AVAILABILITY_INVALID_REQUEST",
  "AVAILABILITY_ITEM_NOT_FOUND",
  "AVAILABILITY_CAFETERIA_NOT_FOUND",
  "AVAILABILITY_DAY_EXPIRED",
  "AVAILABILITY_CAFETERIA_INACTIVE",
  "AVAILABILITY_ITEM_INACTIVE",
  "AVAILABILITY_CATALOG_INVALID",
  "AVAILABILITY_TEMPORARILY_UNAVAILABLE",
  "AVAILABILITY_INTERNAL_ERROR",
  "CLIENT_PROFILE_NOT_FOUND",
  "CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE",
  "CAFETERIA_NOT_FOUND",
  "CAFETERIA_NOT_SUBSCRIBED",
  "CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE",
  "ORDER_NOT_FOUND",
  "INVALID_ORDER_REQUEST",
  "ORDER_LIMIT_EXCEEDED",
  "ORDER_NOTE_TOO_LONG",
  "CAFETERIA_CLOSED",
  "PRODUCT_UNAVAILABLE",
  "ACTIVE_ORDER_EXISTS",
  "IDEMPOTENCY_KEY_CONFLICT",
  "ORDER_TEMPORARILY_UNAVAILABLE",
  "INVALID_ORDER_STATE",
  "ORDER_CANCELLED_BY_CLIENT",
  "ORDER_ALREADY_PREPARING",
  "ORDER_CONCURRENT_MODIFICATION",
  "ORDER_PROCESSING_SEQUENCE_VIOLATION",
  "REMINDER_TOO_EARLY",
  "REMINDER_LIMIT_REACHED",
  "NOT_COLLECTED_REQUIREMENTS_NOT_MET",
  "REJECTION_REASON_REQUIRED",
  "REJECTION_REASON_TOO_LONG",
  "INVALID_PICKUP_TIME",
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

const ORDER_RETRY =
  "No pudimos enviar tu pedido en este momento. Revisa tu conexión e inténtalo de nuevo; tu carrito se conserva.";
const CAFETERIA_GONE =
  "Esta cafetería ya no está disponible. Elige otra para hacer tu pedido.";
const SOMEONE_ELSE_CHANGED =
  "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.";

/** The generic message of every backend code. A screen may say it more precisely in context. */
export const BACKEND_ERROR_MESSAGES: Record<BackendErrorCode, string> = {
  // Admin · catálogo
  ADMIN_CATALOG_FORBIDDEN: "No tienes permisos para consultar este catálogo.",
  ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu catálogo en este momento. Inténtalo nuevamente.",
  ADMIN_CATALOG_INTERNAL_ERROR:
    "No pudimos cargar tu catálogo. Inténtalo nuevamente.",
  ADMIN_CATALOG_INVALID_REQUEST: "Revisa los datos del producto.",
  ADMIN_CATALOG_PRODUCT_NOT_FOUND:
    "El producto no está disponible en tu catálogo.",
  ADMIN_CATALOG_STALE_VERSION:
    "El producto cambió. Actualiza el catálogo antes de guardar.",
  ADMIN_CATALOG_DUPLICATE_NAME:
    "Ya existe un producto con ese nombre en tu cafetería.",
  ADMIN_CATALOG_CAFETERIA_INACTIVE:
    "La cafetería está inactiva y todavía no está visible para los clientes. El catálogo se podrá editar cuando el equipo de UniFood la active.",
  // Admin · perfil
  ADMIN_PROFILE_FORBIDDEN: "No tienes permisos para consultar este perfil.",
  ADMIN_PROFILE_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu perfil en este momento. Inténtalo nuevamente.",
  ADMIN_PROFILE_INTERNAL_ERROR:
    "No pudimos cargar tu perfil. Inténtalo nuevamente.",
  // Super admin
  SUPER_ADMIN_FORBIDDEN: "No tienes permisos para la administración global.",
  SUPER_ADMIN_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar las cafeterías en este momento.",
  SUPER_ADMIN_INTERNAL_ERROR: "No pudimos cargar las cafeterías.",
  SUPER_ADMIN_INVALID_REQUEST: "La solicitud no es válida.",
  BILLING_INVALID_REQUEST:
    "Revisa el modelo de cobro y sus montos en pesos enteros.",
  VISIBILITY_STATE_CHANGED: SOMEONE_ELSE_CHANGED,
  BILLING_STATE_CHANGED: SOMEONE_ELSE_CHANGED,
  CAFETERIA_REQUIRES_ADMIN:
    "Asigna un administrador activo antes de hacer visible esta cafetería.",
  // Worker · perfil
  WORKER_PROFILE_FORBIDDEN: "No tienes permisos para consultar este perfil.",
  WORKER_PROFILE_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu perfil en este momento. Inténtalo nuevamente.",
  WORKER_PROFILE_INTERNAL_ERROR:
    "No pudimos cargar tu perfil. Inténtalo nuevamente.",
  // Worker · historial
  WORKER_HISTORY_FORBIDDEN: "No tienes permisos para consultar este historial.",
  WORKER_HISTORY_INVALID_REQUEST:
    "Los filtros o la página ya no son válidos. Actualiza el historial.",
  WORKER_HISTORY_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar el historial en este momento.",
  WORKER_HISTORY_INTERNAL_ERROR:
    "No pudimos cargar el historial en este momento.",
  // Worker · disponibilidad
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
  AVAILABILITY_CATALOG_INVALID:
    "El catálogo requiere una revisión administrativa.",
  AVAILABILITY_TEMPORARILY_UNAVAILABLE:
    "La disponibilidad no está disponible en este momento. Inténtalo nuevamente.",
  AVAILABILITY_INTERNAL_ERROR: "No pudimos gestionar la disponibilidad.",
  // Cliente · perfil y catálogo (F5: new, they had no message in the front)
  CLIENT_PROFILE_NOT_FOUND:
    "No encontramos tu perfil. Cierra sesión y vuelve a entrar; si sigue igual, escríbenos.",
  CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu perfil en este momento. Inténtalo de nuevo en unos segundos.",
  CAFETERIA_NOT_FOUND: CAFETERIA_GONE,
  CAFETERIA_NOT_SUBSCRIBED: CAFETERIA_GONE,
  CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar el menú en este momento. Inténtalo de nuevo en unos segundos.",
  // Cliente · pedido
  ORDER_NOT_FOUND: "No encontramos ese pedido.",
  INVALID_ORDER_REQUEST:
    "No pudimos validar tu pedido. Revisa tu carrito e inténtalo de nuevo.",
  ORDER_LIMIT_EXCEEDED:
    "Un pedido admite hasta 10 unidades por producto y 15 en total. Ajusta tu carrito.",
  ORDER_NOTE_TOO_LONG: "La nota admite hasta 200 caracteres.",
  CAFETERIA_CLOSED:
    "La cafetería está cerrada en este momento. Tu carrito se conserva; podrás pedir cuando abra.",
  PRODUCT_UNAVAILABLE:
    "Uno de los productos ya no está disponible. Actualiza tu carrito para continuar.",
  ACTIVE_ORDER_EXISTS:
    "Ya tienes un pedido en curso. Recógelo o cancélalo antes de hacer otro.",
  IDEMPOTENCY_KEY_CONFLICT:
    "Tu pedido cambió mientras se enviaba. Revisa el resumen y confirma de nuevo.",
  ORDER_TEMPORARILY_UNAVAILABLE: ORDER_RETRY,
  INVALID_PICKUP_TIME:
    "La hora de recogida ya no es válida. Elige una hora de hoy posterior a la actual o envía el pedido lo antes posible.",
  // Pedido · estados (worker y cliente)
  INVALID_ORDER_STATE: ORDER_STATE_CHANGED,
  ORDER_CANCELLED_BY_CLIENT: "El cliente canceló este pedido.",
  ORDER_ALREADY_PREPARING:
    "Tu pedido ya está en preparación y no puede cancelarse.",
  ORDER_CONCURRENT_MODIFICATION: ORDER_STATE_CHANGED,
  ORDER_PROCESSING_SEQUENCE_VIOLATION:
    "Primero pasa a preparación el pedido más antiguo de hoy.",
  REMINDER_TOO_EARLY:
    "Aún no puedes volver a avisar. Espera 5 minutos desde el último aviso.",
  REMINDER_LIMIT_REACHED:
    "Ya enviaste los 3 avisos a este pedido. Puedes marcarlo como no recogido.",
  NOT_COLLECTED_REQUIREMENTS_NOT_MET:
    "Para marcarlo como no recogido primero debes enviar los 3 avisos.",
  REJECTION_REASON_REQUIRED:
    "Escribe el motivo del rechazo, con al menos 3 caracteres.",
  REJECTION_REASON_TOO_LONG: `El motivo del rechazo admite hasta ${MAX_REJECTION_REASON} caracteres.`,
};

export const isBackendErrorCode = (code: unknown): code is BackendErrorCode =>
  typeof code === "string" && Object.hasOwn(BACKEND_ERROR_MESSAGES, code);

/** The message of a backend code, or the screen's fallback when the code is unknown or absent. */
export function backendErrorMessage(code: unknown, fallback: string): string {
  return isBackendErrorCode(code) ? BACKEND_ERROR_MESSAGES[code] : fallback;
}
