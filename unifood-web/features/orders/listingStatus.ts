// What the worker board says when the operational listing cannot be read (docs/ui-paneles.md,
// W1, W2 and L1). Fixed Spanish texts chosen by HTTP status; no backend text reaches the screen.

/** The same fixed text the BFF sends for an account without exactly one cafeteria. */
export const LISTING_FORBIDDEN_MESSAGE =
  "No se pudo resolver la cafetería de tu cuenta.";

export type ListingFailure = {
  /** HTTP status of the BFF answer, or null for a network failure or a timeout. */
  status: number | null;
};

export type ListingErrorView = {
  title: string;
  message: string;
  /** retry: try again now; login: the session is gone; none: nothing the worker can do. */
  action: "retry" | "login" | "none";
  /** Whether the orders already on screen must be withdrawn. */
  withdraw: boolean;
};

export function listingFailure(cause: unknown): ListingFailure {
  const status = (cause as { status?: unknown } | null)?.status;
  return { status: typeof status === "number" ? status : null };
}

export function listingErrorView(failure: ListingFailure): ListingErrorView {
  if (failure.status === 401)
    return {
      title: "Tu sesión terminó",
      message: "Inicia sesión de nuevo para ver los pedidos.",
      action: "login",
      withdraw: true,
    };
  if (failure.status === 403)
    return {
      title: "No pudimos abrir tu tablero",
      message: LISTING_FORBIDDEN_MESSAGE,
      action: "none",
      withdraw: true,
    };
  return {
    title: "No pudimos cargar los pedidos",
    message: "Revisa la conexión. Lo seguimos intentando cada 10 segundos.",
    action: "retry",
    withdraw: false,
  };
}

/** Banner over a board that still shows the last orders it could read. */
// C (jj/cliente-ajustes-2): a network drop is a calm notice, not an alarm.
export const STALE_LISTING_MESSAGE =
  "Sin conexión. Mostramos los últimos pedidos y lo seguimos intentando.";

const BOGOTA_CLOCK = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Header status: truthful about the last successful read, never a fixed «En línea». */
export function syncStatusLabel(
  lastSyncedAt: number | null,
  failing: boolean,
): { text: string; time?: string; tone: "ok" | "warning" } | null {
  // Same text as HEADER_OFFLINE in features/shared/messages.ts (messages-catalog checks it);
  // this file stays import-free for the sandboxed order tests.
  if (failing) return { text: "Sin conexión", tone: "warning" };
  // Before the first read the board already shows its skeleton; no «Conectando…» text.
  if (lastSyncedAt === null) return null;
  const time = BOGOTA_CLOCK.format(new Date(lastSyncedAt));
  return { text: `Actualizado a las ${time}`, time, tone: "ok" };
}

const STATUS_WORDS: Record<string, string> = {
  pending: "pendiente",
  preparing: "en preparación",
  ready: "listo para entregar",
  called: "cliente llamado",
  delivered: "entregado",
  not_collected: "no recogido",
  cancelled: "cancelado",
};

/** Polite announcement of an order that changed state since the previous read (W8). */
export function transitionAnnouncement(
  student: string,
  status: string,
): string {
  return `Pedido de ${student}: ${STATUS_WORDS[status] ?? status}.`;
}

export const newOrderAnnouncement = (student: string) =>
  `Nuevo pedido de ${student}.`;

/** How long an order keeps the «Nuevo» badge after it first appears (W11). */
export const NEW_ORDER_BADGE_MS = 60_000;
