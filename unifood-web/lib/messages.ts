// Single catalogue of the response texts that several panels repeat word for word
// (docs/ui-paneles.md, «Tokens», mensajes de respuesta). Same meaning and wording as before.

export const SESSION_CHECK_UNAVAILABLE =
  "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.";

export const SESSION_EXPIRED = "Tu sesión expiró. Inicia sesión de nuevo.";

export const ORDER_STATE_CHANGED =
  "El pedido ya cambió de estado. Revisa el tablero actualizado.";

// Push notifications to the phone (docs/notificaciones-push.md). The in-app notice stays the
// primary channel: every text below says so whenever push is not available.
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
  unsupported:
    "Este navegador no permite avisos en el teléfono. Seguirás viendo los avisos dentro de UniFood.",
  disabledOnServer:
    "Los avisos al teléfono no están disponibles por ahora. Seguirás viendo los avisos dentro de UniFood.",
  deniedTitle: "Los avisos están bloqueados",
  deniedBody:
    "Permite las notificaciones de UniFood en los ajustes del navegador o del teléfono y vuelve a intentarlo.",
  iosInstallTitle: "Agrega UniFood a tu pantalla de inicio",
  iosInstallSteps:
    "En Safari, toca Compartir y luego «Agregar a pantalla de inicio». Abre UniFood desde ese ícono para activar los avisos.",
  iosTooOld:
    "Tu iPhone necesita iOS 16.4 o superior para recibir avisos. Seguirás viendo los avisos dentro de UniFood.",
  failed: "No pudimos activar los avisos. Inténtalo de nuevo.",
  rateLimited:
    "Hiciste demasiados cambios en los avisos. Espera un minuto e inténtalo de nuevo.",
} as const;

export type PushMessageKey = keyof typeof PUSH_MESSAGES;
