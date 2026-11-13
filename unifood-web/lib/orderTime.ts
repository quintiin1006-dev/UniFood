/**
 * Formatea un timestamp ISO como tiempo
 * relativo en español ("Hace 2 min").
 */
export function formatRelativeTime(createdAt: string): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000),
  );

  if (elapsedMinutes < 1) {
    return "Hace un momento";
  }

  if (elapsedMinutes < 60) {
    return `Hace ${elapsedMinutes} min`;
  }

  const hours = Math.floor(elapsedMinutes / 60);

  if (hours < 24) {
    return hours === 1 ? "Hace 1 hora" : `Hace ${hours} horas`;
  }

  const days = Math.floor(hours / 24);

  return days === 1 ? "Hace 1 día" : `Hace ${days} días`;
}

const BOGOTA_CLOCK = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Hora de reloj en Bogotá y en 24 h ("12:32"), la misma forma que «Recoger a las HH:mm»
 * (docs/ui-paneles.md, D3), sea cual sea la zona del navegador.
 */
export function formatClockTime(iso: string): string {
  return BOGOTA_CLOCK.format(new Date(iso));
}
