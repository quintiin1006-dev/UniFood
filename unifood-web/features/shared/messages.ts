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
/** The worker header status when the listing cannot be read. */
export const HEADER_OFFLINE = "Sin conexión";
/* C (jj/cliente-ajustes-2): the brand's connection notice (features/shared/components). */
export const CONNECTION_OFFLINE =
  "Sin conexión. Mostramos lo último que cargó.";
export const CONNECTION_STALE_HISTORY =
  "Mostramos la última consulta. Lo intentamos de nuevo en un momento.";
export const CONNECTION_RETRY = "Reintentar";
export const CONNECTION_RETRYING = "Reintentando…";

export const SAVING = "Guardando…";

/** «Mi pedido»: the client's own wording; the worker's ORDER_STATE_CHANGED speaks of the board. */
export const CLIENT_ORDER_CHANGED =
  "Tu pedido cambió de estado. Te mostramos cómo está ahora.";

export const CLIENT_ORDERS_FORBIDDEN =
  "No tienes permisos para ver tus pedidos.";

/** The server could not be reached: network, timeout or a 5xx. Never an empty result. */
export const CONNECTION_FAILED =
  "No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.";

/* ---------- Cliente · Pedido e historial (un solo módulo, /cuenta/pedido) ---------- */

/** The five stages of the normal flow (PENDING → DELIVERED), short enough for a 360 px row. */
export const ORDER_STAGE_LABELS = [
  "Recibido",
  "Preparando",
  "Listo",
  "Llamado",
  "Entregado",
] as const;

export const stageCounter = (position: number, total: number) =>
  `Etapa ${position} de ${total}`;
export const STAGE_CURRENT = "etapa actual";
export const STAGE_DONE = "completada";
export const ORDER_STAGES_LABEL = "Etapas de tu pedido";

export const CLIENT_ORDER_TITLE = "Mi pedido";
/** The name the worker reads at the counter, shown from the session profile. */
export const CLIENT_ORDER_NAME_LABEL = "Nombre";
export const CLIENT_ORDER_READY_TITLE =
  "Tu pedido está listo, pasa a recogerlo";
export const CLIENT_ORDER_CANCEL = "Cancelar pedido";
export const CLIENT_ORDER_CANCELLED_NOTICE = "Pedido cancelado.";
export const CLIENT_ORDER_NOT_CANCELLABLE =
  "Tu pedido ya no se puede cancelar.";
export const CLIENT_ORDER_NOTE_LABEL = "Tu nota";
export const CLIENT_ORDER_PICKUP_LABEL = "Recogida";
export const CLIENT_ORDER_CASH_NOTE =
  "Pagas en efectivo en caja; la cafetería confirma el total final.";
export const CLIENT_ORDER_EMPTY_TITLE = "No tienes un pedido activo";
export const CLIENT_ORDER_EMPTY_BODY =
  "Cuando envíes un pedido podrás seguirlo aquí.";
export const CLIENT_ORDER_GO_MENU = "Ver el menú";

export const CANCEL_DIALOG_TITLE = "¿Cancelar tu pedido?";
export const CANCEL_DIALOG_BODY =
  "Solo puedes cancelarlo mientras esté pendiente. Esta acción no se puede deshacer.";
export const CANCEL_KEEP = "Mantener pedido";
export const CANCEL_CONFIRM = "Sí, cancelar pedido";
export const CANCEL_CONFIRMING = "Cancelando…";

export const HISTORY_TITLE = "Historial";
export const HISTORY_EMPTY_TITLE = "Aún no tienes pedidos anteriores";
export const HISTORY_EMPTY_BODY =
  "Tus pedidos entregados, cancelados o no recogidos aparecerán aquí.";
export const HISTORY_LOAD_MORE = "Cargar más";
export const HISTORY_LOADING_MORE = "Cargando…";

/* ---------- Cliente · catálogo en vivo y cafetería cerrada ---------- */

/** The banner that replaces the carousel while the cafeteria is closed: the first thing seen. */
export const CLOSED_BANNER_TITLE = "Cafetería cerrada";
export const CLOSED_BANNER_BODY =
  "Vuelve más tarde. Puedes ver el menú mientras tanto.";
/** The cart line of a product that stopped being available while it was in the cart. */
export const CART_LINE_UNAVAILABLE = "Ya no está disponible";
/** Why the menu cannot be ordered from right now, shown where the «+» would be. */
export const MENU_CLOSED_CHIP = "Cerrada";

/* ---------- Cliente · Inicio (orden de jj/cliente-pulido) ---------- */

/** Mi pedido: the small bell that turns the notice sound on or off. */
export const SOUND_TOGGLE_LABEL = "Sonido de avisos";
/* Carrito y confirmación en una sola pantalla. */
export const CART_TITLE = "Tu carrito";
export const CART_PICKUP_AT = "Recoger en";
export const CART_ADD_NOTE = "Agregar una nota";
export const CART_TOTAL = "Total";
export const CART_CONFIRM = "Confirmar pedido";
export const CART_EMPTY_ACTION = "Vaciar carrito";
/* Contraseña olvidada: un código al correo; la respuesta no revela si la cuenta existe. */
/** Same text whether or not the address has an account: it never reveals which ones exist. */
export const RECOVERY_CODE_SENT =
  "Te enviamos un código de verificación a tu correo registrado";
export const RECOVERY_TITLE = "Cambiar contraseña";
export const RECOVERY_SEND = "Enviar código de verificación";
export const recoverySendTo = (email: string) =>
  `Enviaremos un código de verificación a ${email}.`;
export const RECOVERY_STEP_TWO_NOTE =
  "Escribe el código de 6 dígitos que te llegó al correo.";
export const RECOVERY_STEP_THREE_NOTE =
  "Código verificado. Ahora crea tu nueva contraseña.";
export const RECOVERY_VERIFY = "Verificar código";
export const RECOVERY_CODE_LABEL = "Código de verificación";
export const RECOVERY_NEW_PASSWORD = "Nueva contraseña";
export const RECOVERY_CONFIRM_PASSWORD = "Confirmar nueva contraseña";
export const RECOVERY_SUBMIT = "Cambiar contraseña";
export const RECOVERY_RESEND = "Reenviar código";
export const recoveryResendIn = (seconds: number) =>
  `Reenviar código en ${seconds} s`;
export const PASSWORD_UPDATED = "Contraseña actualizada";
/* B (jj/cliente-ajustes-2): what a busy step says while it waits for the server. */
export const AUTH_SENDING = "Enviando…";
export const AUTH_VERIFYING = "Verificando…";
export const AUTH_SAVING = "Guardando…";
export const AUTH_SLOW = "Esto está tardando más de lo normal…";
/** How long a step waits before saying it is slow, and before giving up. */
export const AUTH_SLOW_MS = 3000;
export const AUTH_TIMEOUT_MS = 20000;
export const CAFETERIA_STATUS_OPEN = "Abierta";
export const CAFETERIA_STATUS_CLOSED = "Cerrada";
export const CAFETERIA_PICKER_LIST = "Cafeterías disponibles";
export const cafeteriaPickerLabel = (
  name: string,
  site: string,
  status: string,
) => `Cambiar cafetería. ${name}, ${site}, ${status}`;
export const HOME_ALL_CATEGORIES = "Todo";
export const HOME_SEE_ALL = "Ver todo";
/** Only when the whole menu has nothing to order; empty categories are simply not shown. */
export const HOME_EMPTY_MENU =
  "Aún no hay productos para pedir. Vuelve más tarde.";
/** Second line of the closed notice, only when the opening time is known. */
export const closedOpensAt = (when: string) => `Abre ${when}`;
export const CAROUSEL_LABEL = "Productos destacados";

/* ---------- Cliente · carta «Menú del día» en Inicio (jj/menu-dia-carta-inicio) ---------- */
export const DAILY_MENU_LOADING = "Cargando el menú del día";
export const DAILY_MENU_COMPOSE = "Armar mi almuerzo";
export const DAILY_MENU_COLLAPSE = "Ocultar opciones";
export const DAILY_MENU_VIEW = "Ver el menú";
export const DAILY_MENU_SKIP = "Ninguna";
export const DAILY_MENU_ADD = "Agregar al carrito";
/** Everything chosen, but the cart for the menu arrives with PR 6. */
export const DAILY_MENU_ADD_SOON = "Muy pronto podrás agregarlo al carrito.";
export const dailyMenuMissing = (labels: string[]) =>
  `Falta elegir: ${labels.join(", ")}`;
export const dailyMenuProgress = (done: number, total: number) =>
  `${done} de ${total} ${total === 1 ? "elegida" : "elegidas"}`;
export const dailyMenuExtra = (price: string) => `+ ${price}`;

/* ---------- Cliente · agregar al carrito (jj/cliente-agregar) ---------- */

/** Announced after each «+»: what was done and how many are now in the cart. */
export const addedLive = (count: number) => `Agregado, ${count} en el carrito`;
export const addProductLabel = (name: string) => `Agregar ${name} al carrito`;
/** Shown for 3 s only when the student tries to go past a limit; never as fixed text. */
export const LIMIT_PER_PRODUCT = "Máximo 10 por producto";
export const LIMIT_PER_ORDER = "Máximo 15 por pedido";
export const CLOSED_BANNER_BACK_LATER = "Vuelve más tarde";
export const closedOpensAtTime = (time: string) => `Abre a las ${time}`;
/** Mi pedido, ready banner while the cafeteria is calling the student. */
export const CLIENT_ORDER_CALLED_TITLE = "Te estamos llamando";

/* ---------- Push notifications (docs/notificaciones-push.md) ---------- */

// The in-app notice stays the primary channel: whenever push is not available, the text says so.
const IN_APP_STAYS = "Seguirás viendo los avisos dentro de UniFood.";
const PUSH_DISABLED_TEXT = `Los avisos al teléfono no están disponibles por ahora. ${IN_APP_STAYS}`;
const PUSH_RATE_LIMITED_TEXT =
  "Hiciste demasiados cambios en los avisos. Espera un minuto e inténtalo de nuevo.";

export const PUSH_MESSAGES = {
  cardTitle: "Activar avisos de tu pedido",
  cardBody:
    "Te avisamos en el teléfono cuando tu pedido esté listo, aunque cierres UniFood.",
  enable: "Activar avisos",
  enabling: "Activando…",
  later: "Ahora no",
  toggleLabel: "Avisos en el teléfono",
  toggleHintClient: "Te avisamos cuando tu pedido cambie de estado.",
  toggleHintWorker: "Te avisamos cuando llegue un pedido nuevo.",
  enabled: "Avisos activados en este dispositivo.",
  disabled: "Avisos desactivados en este dispositivo.",
  unsupported: `Este navegador no permite avisos en el teléfono. ${IN_APP_STAYS}`,
  disabledOnServer: PUSH_DISABLED_TEXT,
  deniedTitle: "Los avisos están bloqueados",
  deniedBody:
    "Permite las notificaciones de UniFood en los ajustes del navegador o del teléfono y vuelve a intentarlo.",
  iosInstallTitle: "Agrega UniFood a tu pantalla de inicio",
  iosInstallSteps:
    "En Safari, toca Compartir y luego «Agregar a pantalla de inicio». Abre UniFood desde ese ícono para activar los avisos.",
  iosTooOld: `Tu iPhone necesita iOS 16.4 o superior para recibir avisos. ${IN_APP_STAYS}`,
  failed: "No pudimos activar los avisos. Inténtalo de nuevo.",
  rateLimited: PUSH_RATE_LIMITED_TEXT,
  // C4: the header bell is the one switch for every client notification.
  bellLabelOn: "Notificaciones activadas. Abrir opciones.",
  bellLabelOff: "Notificaciones desactivadas. Abrir opciones.",
  bellStatusOn: "Notificaciones activadas",
  bellStatusOff: "Notificaciones desactivadas",
  bellEnable: "Activar notificaciones",
  bellDisable: "Desactivar notificaciones",
  bellBlocked:
    "El navegador las bloqueó: permite las notificaciones de UniFood en los ajustes del sitio y vuelve a intentarlo.",
} as const;

export type PushMessageKey = keyof typeof PUSH_MESSAGES;

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
  "PUSH_FORBIDDEN",
  "PUSH_SUBSCRIPTION_INVALID",
  "PUSH_RATE_LIMITED",
  "PUSH_DISABLED",
  "PUSH_TEMPORARILY_UNAVAILABLE",
  "PUSH_INTERNAL_ERROR",
  "CLIENT_PROFILE_NOT_FOUND",
  "CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE",
  "CAFETERIA_NOT_FOUND",
  "CAFETERIA_NOT_SUBSCRIBED",
  "CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE",
  "DAILY_MENU_DISABLED",
  "DAILY_MENU_NOT_PUBLISHED",
  "DAILY_MENU_INCOMPLETE",
  "DAILY_MENU_PRICE_NOT_SET",
  "DAILY_MENU_VERSION_CONFLICT",
  "DAILY_MENU_OPTION_INVALID",
  "DAILY_MENU_OPTION_DUPLICATED",
  "DAILY_MENU_TEXT_TOO_LONG",
  "DAILY_MENU_CATEGORY_NOT_FOUND",
  "DAILY_MENU_ADDITION_UNAVAILABLE",
  "DAILY_MENU_DATE_CHANGED",
  "DAILY_MENU_SELECTION_INVALID",
  "DAILY_MENU_INVALID_REQUEST",
  "DAILY_MENU_FORBIDDEN",
  "DAILY_MENU_TEMPORARILY_UNAVAILABLE",
  "DAILY_MENU_INTERNAL_ERROR",
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
  // Avisos al teléfono (push)
  PUSH_FORBIDDEN: "No puedes activar avisos desde esta cuenta.",
  PUSH_SUBSCRIPTION_INVALID:
    "Este navegador entregó una suscripción de avisos no válida.",
  PUSH_RATE_LIMITED: PUSH_RATE_LIMITED_TEXT,
  PUSH_DISABLED: PUSH_DISABLED_TEXT,
  PUSH_TEMPORARILY_UNAVAILABLE:
    "No pudimos guardar tus avisos en este momento. Inténtalo nuevamente.",
  PUSH_INTERNAL_ERROR: "No pudimos guardar tus avisos. Inténtalo nuevamente.",
  // Cliente · perfil y catálogo (F5: new, they had no message in the front)
  CLIENT_PROFILE_NOT_FOUND:
    "No encontramos tu perfil. Cierra sesión y vuelve a entrar; si sigue igual, escríbenos.",
  CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar tu perfil en este momento. Inténtalo de nuevo en unos segundos.",
  CAFETERIA_NOT_FOUND: CAFETERIA_GONE,
  CAFETERIA_NOT_SUBSCRIBED: CAFETERIA_GONE,
  CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE:
    "No pudimos cargar el menú en este momento. Inténtalo de nuevo en unos segundos.",
  // Cliente · menú del día (PR 2; los demás códigos llegan en los PRs 3 y 4)
  DAILY_MENU_DISABLED: "El menú del día no está disponible por ahora.",
  DAILY_MENU_NOT_PUBLISHED: "Hoy todavía no hay menú del día publicado.",
  // Worker · menú del día (PR 3)
  DAILY_MENU_INCOMPLETE: "Falta completar el menú antes de publicarlo.",
  DAILY_MENU_PRICE_NOT_SET:
    "El plato del día aún no tiene precio configurado. Pídeselo al administrador.",
  DAILY_MENU_VERSION_CONFLICT:
    "El menú cambió en otra pantalla. Actualizamos los datos; revisa y vuelve a intentarlo.",
  DAILY_MENU_OPTION_INVALID:
    "Cada opción debe tener entre 1 y 350 caracteres, sin comas, y hasta 20 por categoría.",
  DAILY_MENU_OPTION_DUPLICATED: "Hay opciones repetidas en la categoría.",
  DAILY_MENU_TEXT_TOO_LONG:
    "Las opciones de esta categoría superan los 350 caracteres en total.",
  DAILY_MENU_CATEGORY_NOT_FOUND: "No encontramos esa categoría del menú.",
  DAILY_MENU_ADDITION_UNAVAILABLE: "Esa adición no está disponible.",
  DAILY_MENU_DATE_CHANGED:
    "Cambió el día. Actualiza la pantalla para ver el menú de hoy.",
  DAILY_MENU_SELECTION_INVALID:
    "Revisa tu elección del menú del día: falta una opción o ya no está disponible.",
  DAILY_MENU_INVALID_REQUEST:
    "Revisa los datos del menú y la fecha de la pantalla.",
  DAILY_MENU_FORBIDDEN: "No tienes permisos para gestionar el menú del día.",
  DAILY_MENU_TEMPORARILY_UNAVAILABLE:
    "No pudimos guardar el menú en este momento. Inténtalo nuevamente.",
  DAILY_MENU_INTERNAL_ERROR: "No pudimos gestionar el menú del día.",
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
    "Ya enviaste el máximo de recordatorios para este pedido. Puedes marcarlo como no recogido.",
  NOT_COLLECTED_REQUIREMENTS_NOT_MET:
    "Para marcarlo como no recogido primero debes enviar todos los recordatorios.",
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

/* ---------- Llamadas: recordatorio (jj/cliente-ajustes · D5) ---------- */
export const REMIND_LABEL = "Recordar al estudiante";
export const REMIND_SENDING = "Enviando recordatorio…";
export const remindWaitTitle = (minutes: number) =>
  `Podrás volver a recordar en ${minutes} min`;
export const REMINDER_LIMIT_NOTICE =
  "Ya enviaste el máximo de recordatorios para este pedido";
export const NOT_COLLECTED_NEEDS_REMINDERS =
  "Disponible después de enviar todos los recordatorios";
