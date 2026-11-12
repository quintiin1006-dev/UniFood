// The business day and every clock the worker reads are Bogotá's (docs/decisiones.md §6),
// whatever the zone of the browser.
const BOGOTA_CLOCK = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "Recoger a las HH:mm" in Bogotá time, or null for an order without a pickup time ("lo
 * antes posible") or an unreadable one. Informative only: it never reorders the queue.
 */
export function pickupLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = BOGOTA_CLOCK.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) return null;
  return `Recoger a las ${hour}:${minute}`;
}
